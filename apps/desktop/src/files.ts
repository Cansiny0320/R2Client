import { app, clipboard, dialog, safeStorage, shell } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
  link,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MiB, objectCategory, safeRelative } from "@r2client/core";
import type { Credentials, Driver, Item, Job, Source, SourceReader } from "@r2client/core";
import { createR2 } from "@r2client/s3";
import { ffmpegArgs } from "./media";

type FileRecord = { file: string; name: string; temp?: boolean };
const types: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".ogg": "audio/ogg",
  ".json": "application/json",
  ".csv": "text/csv",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
};
const mime = (name: string) =>
  types[path.extname(name).toLowerCase()] || "application/octet-stream";
const ENOENT = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";
function idOk(id: string) {
  return /^[a-f0-9-]{36}$/i.test(id);
}
function run(exe: string, args: string[], signal?: AbortSignal, timeout = 3600_000) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
    });
    let err = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (s) => {
      err = (err + s).slice(-2000);
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(err.trim() || "FFmpeg exited with status " + code)),
    );
  });
}

export async function desktopDriver() {
  const user = app.getPath("userData"),
    state = path.join(user, "workspace"),
    temp = path.join(user, "staging");
  await Promise.all([mkdir(state, { recursive: true }), mkdir(temp, { recursive: true })]);
  const chains = new Map<string, Promise<void>>();
  const fileFor = (key: string) =>
    path.join(state, Buffer.from(key).toString("base64url").slice(0, 180) + ".json");
  async function load<T>(key: string): Promise<T | undefined> {
    const p = fileFor(key);
    try {
      const row = JSON.parse(await readFile(p, "utf8")) as { key: string; value: T };
      return row.key === key ? row.value : undefined;
    } catch (e) {
      if (!ENOENT(e)) throw e;
      return undefined;
    }
  }
  async function save<T>(key: string, value: T) {
    const p = fileFor(key),
      data = JSON.stringify({ key, value }),
      next = (chains.get(p) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          const t = p + "." + crypto.randomUUID() + ".tmp";
          await writeFile(t, data, { mode: 0o600 });
          try {
            await rename(t, p);
          } finally {
            await rm(t, { force: true }).catch(() => {});
          }
        });
    chains.set(p, next);
    try {
      await next;
    } finally {
      if (chains.get(p) === next) chains.delete(p);
    }
  }
  // Hash all state names to avoid long paths and collisions between long object keys.
  const hashKey = async (key: string) =>
    Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))).toString(
      "hex",
    );
  const kvLoad = async <T>(key: string) => load<T>(await hashKey(key));
  const kvSave = async <T>(key: string, v: T) => save(await hashKey(key), v);
  const readSet = async <T>(key: string) => (await kvLoad<Record<string, T>>(key)) ?? {};
  const [sources, dirs] = await Promise.all([
    readSet<FileRecord>("file-handles"),
    readSet<string>("directory-handles"),
  ]);
  const secrets = new Map<string, Credentials>();
  function secure() {
    return (
      process.platform !== "linux" ||
      !["basic_text", "unknown"].includes(safeStorage.getSelectedStorageBackend())
    );
  }
  async function register(file: string, name: string, isTemp = false): Promise<Source> {
    const real = await realpath(file),
      s = await stat(real);
    if (!s.isFile()) throw new Error("Select a regular file");
    const id = crypto.randomUUID();
    sources[id] = { file: real, name, temp: isTemp };
    await kvSave("file-handles", sources);
    return { id, name, size: s.size, modified: s.mtimeMs, type: mime(name) };
  }
  async function findFiles(root: string, prefix: string): Promise<Source[]> {
    const out: Source[] = [];
    async function visit(dir: string, relative: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name),
          next = relative + "/" + entry.name;
        if (entry.isDirectory()) await visit(file, next);
        else if (entry.isFile()) out.push(await register(file, next));
      }
    }
    await visit(root, prefix);
    return out;
  }
  async function output(destination: string, create: boolean) {
    const [id, relative] = JSON.parse(destination) as [string, string],
      parts = safeRelative(relative);
    if (!idOk(id) || !dirs[id]) throw new Error("Choose a native download folder first");
    let current = await realpath(dirs[id]!);
    const filename = parts.pop()!;
    for (const segment of parts) {
      current = path.join(current, segment);
      if (create)
        await mkdir(current).catch((e) => {
          if (e.code !== "EEXIST") throw e;
        });
      const node = await lstat(current);
      if (!node.isDirectory() || node.isSymbolicLink())
        throw new Error("Download path is not a regular directory");
    }
    return path.join(current, filename);
  }
  async function ffmpeg() {
    const stored = await kvLoad<string>("ffmpeg");
    const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const candidates = [stored, path.join(process.resourcesPath, exe), exe].filter(
      (p): p is string => !!p,
    );
    for (const f of candidates)
      try {
        await run(f, ["-version"], undefined, 5000);
        return f;
      } catch {
        /* try next */
      }
    return undefined;
  }
  const driver: Driver = {
    platform: "desktop",
    store: (p, c) => createR2(p, c!),
    load: kvLoad,
    save: kvSave,
    async getSecret(id) {
      const cached = secrets.get(id);
      if (cached) return cached;
      const encrypted = await kvLoad<string | null>("credential:" + id);
      if (!encrypted || !secure() || !(await safeStorage.isAsyncEncryptionAvailable()))
        return undefined;
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
          Buffer.from(encrypted, "base64"),
        );
        const c = JSON.parse(result) as Credentials;
        secrets.set(id, c);
        if (shouldReEncrypt) await driver.setSecret(id, c, true);
        return c;
      } catch {
        return undefined;
      }
    },
    async setSecret(id, c, remember) {
      if (!c) {
        secrets.delete(id);
        await kvSave("credential:" + id, null);
        return;
      }
      if (remember) {
        if (!secure() || !(await safeStorage.isAsyncEncryptionAvailable()))
          throw new Error(
            "System credential storage is unavailable. Turn off Remember credentials to connect.",
          );
        const data = await safeStorage.encryptStringAsync(JSON.stringify(c));
        await kvSave("credential:" + id, data.toString("base64"));
      } else await kvSave("credential:" + id, null);
      secrets.set(id, c);
    },
    async source(id): Promise<SourceReader | undefined> {
      if (!idOk(id)) return undefined;
      const entry = sources[id];
      if (!entry) return undefined;
      const s = await stat(entry.file).catch(() => undefined);
      if (!s?.isFile()) return undefined;
      return {
        id,
        name: entry.name,
        size: s.size,
        type: mime(entry.name),
        modified: s.mtimeMs,
        async read(a, b) {
          const f = await open(entry.file, "r");
          try {
            const current = await f.stat();
            if (current.size !== s.size || current.mtimeMs !== s.mtimeMs)
              throw new Error("Local file changed");
            const buffer = Buffer.allocUnsafe(b - a);
            let offset = 0;
            while (offset < buffer.length) {
              const read = await f.read(buffer, offset, buffer.length - offset, a + offset);
              if (!read.bytesRead) break;
              offset += read.bytesRead;
            }
            return buffer.subarray(0, offset);
          } finally {
            await f.close();
          }
        },
      };
    },
    async disposeSource(id) {
      if (!idOk(id)) return;
      const old = sources[id];
      delete sources[id];
      await kvSave("file-handles", sources);
      if (old?.temp && path.dirname(old.file) === temp) await rm(old.file, { force: true });
    },
    async pickSources(directory) {
      const r = await dialog.showOpenDialog({
        properties: directory ? ["openDirectory"] : ["openFile", "multiSelections"],
      });
      return (
        await Promise.all(
          r.filePaths.map((p) =>
            directory
              ? findFiles(p, path.basename(p))
              : register(p, path.basename(p)).then((v) => [v]),
          ),
        )
      ).flat();
    },
    async pickDestination() {
      const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
      if (r.canceled || !r.filePaths[0]) return undefined;
      const root = await realpath(r.filePaths[0]),
        id = Object.keys(dirs).find((i) => dirs[i] === root) ?? crypto.randomUUID();
      dirs[id] = root;
      await kvSave("directory-handles", dirs);
      return id;
    },
    async revealDestination(id) {
      if (idOk(id) && dirs[id]) {
        const err = await shell.openPath(dirs[id]!);
        if (err) throw new Error(err);
      }
    },
    async fileMatches(destination: string, item: Item) {
      try {
        const file = await output(destination, false),
          s = await lstat(file),
          m = await kvLoad<{ etag?: string; size: number; modified: number }>(
            "download:" + destination,
          );
        return (
          s.isFile() &&
          !s.isSymbolicLink() &&
          !!item.etag &&
          m?.etag === item.etag &&
          s.size === m.size &&
          s.mtimeMs === m.modified
        );
      } catch {
        return false;
      }
    },
    async safeToReplace(destination: string) {
      try {
        const file = await output(destination, false),
          s = await lstat(file);
        const m = await kvLoad<{ size: number; modified: number }>("download:" + destination);
        return (
          s.isFile() && !s.isSymbolicLink() && !!m && s.size === m.size && s.mtimeMs === m.modified
        );
      } catch {
        return false;
      }
    },
    async sink(j: Job) {
      if (!j.destination || !idOk(j.id)) throw new Error("No local destination");
      const dest = j.destination,
        file = await output(dest, true),
        partial = path.join(path.dirname(file), ".r2client-" + j.id + ".partial");
      const checkPartial = async () => {
        try {
          const s = await lstat(partial);
          if (!s.isFile() || s.isSymbolicLink()) throw new Error("Invalid partial file");
          return s.size;
        } catch (e) {
          if (!ENOENT(e)) throw e;
          return 0;
        }
      };
      return {
        bytes: checkPartial,
        append: async (data) => {
          await checkPartial();
          const f = await open(partial, "a");
          try {
            await f.writeFile(data);
          } finally {
            await f.close();
          }
        },
        reset: async () => {
          await checkPartial();
          await writeFile(partial, Buffer.alloc(0));
        },
        remove: async () => {
          await checkPartial();
          await rm(partial, { force: true });
        },
        async finish() {
          await checkPartial();
          if (j.total === 0) await writeFile(partial, Buffer.alloc(0), { flag: "a" });
          const before = await lstat(file).catch((e) => {
            if (!ENOENT(e)) throw e;
            return undefined;
          });
          if (before && (!before.isFile() || before.isSymbolicLink()))
            throw new Error("Destination is not a regular file");
          if (j.replace) await rename(partial, file);
          else {
            await link(partial, file);
            await rm(partial);
          }
          const s = await stat(file);
          await kvSave("download:" + dest, { etag: j.etag, size: s.size, modified: s.mtimeMs });
        },
      };
    },
    async importUrls(urls) {
      const list: Source[] = [];
      for (const href of urls) {
        const u = new URL(href),
          signal = AbortSignal.timeout(120000);
        const r = await fetch(u, { signal, credentials: "omit" });
        if (!r.ok || !r.body) throw new Error("Could not download from " + u.hostname);
        const name = (
          decodeURIComponent(u.pathname.split("/").at(-1) || "download").replace(
            /[/\\<>:"|?*]/g,
            "_",
          ) || "download"
        ).slice(0, 180);
        const filename = path.join(temp, crypto.randomUUID() + path.extname(name).slice(0, 14));
        let size = 0;
        try {
          const cap = new Transform({
            transform(chunk, _enc, cb) {
              size += chunk.length;
              if (size > 100 * MiB) cb(new Error("URL import is limited to 100 MB"));
              else cb(null, chunk);
            },
          });
          await pipeline(
            Readable.fromWeb(r.body as Parameters<typeof Readable.fromWeb>[0]),
            cap,
            createWriteStream(filename, { flags: "wx" }),
            { signal },
          );
          list.push(await register(filename, name, true));
        } catch (e) {
          await rm(filename, { force: true });
          throw e;
        }
      }
      return list;
    },
    async ffmpegStatus() {
      const f = await ffmpeg();
      return { available: !!f, executable: f };
    },
    async configureFfmpeg() {
      const r = await dialog.showOpenDialog({ properties: ["openFile"], title: "Choose FFmpeg" });
      if (r.filePaths[0]) {
        await access(r.filePaths[0]);
        await run(r.filePaths[0], ["-version"], undefined, 5000);
        await kvSave("ffmpeg", r.filePaths[0]);
      }
    },
    async convert(id, preset, signal) {
      if (!idOk(id) || !sources[id]) throw new Error("Select the source file");
      const { file, name } = sources[id]!,
        f = await ffmpeg();
      if (!f) throw new Error("Install FFmpeg or choose the executable in Settings");
      const output = path.join(temp, crypto.randomUUID() + "." + preset.format);
      try {
        const args = ffmpegArgs(file, output, preset, objectCategory(name));
        await run(f, args, signal);
        return await register(output, name.replace(/\.[^./]+$/, "") + "." + preset.format, true);
      } catch (e) {
        await rm(output, { force: true });
        throw e;
      }
    },
    async openExternal(url) {
      await shell.openExternal(url);
    },
  };
  return {
    driver,
    async dropped(entries: { file: string; relative?: string }[]) {
      const list: Source[] = [];
      for (const { file, relative } of entries) {
        if (!path.isAbsolute(file)) throw new Error("Invalid native path");
        const st = await lstat(file),
          name = relative?.split("/").filter(Boolean).join("/") || path.basename(file);
        safeRelative(name);
        if (st.isDirectory()) list.push(...(await findFiles(file, name)));
        else if (st.isFile()) list.push(await register(file, name));
      }
      return list;
    },
    async paste() {
      for (const item of await clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        if (!(blob instanceof Blob)) continue;
        const ext = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
        const f = path.join(temp, crypto.randomUUID() + "." + ext);
        await writeFile(f, new Uint8Array(await blob.arrayBuffer()));
        return {
          sources: [await register(f, "clipboard-" + Date.now() + "." + ext, true)],
          urls: [],
        };
      }
      const lines = (await clipboard.readText())
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, 100),
        files: Source[] = [],
        urls: string[] = [];
      for (const raw of lines) {
        const value = raw.trim().replace(/^"|"$/g, "");
        if (/^https?:\/\//i.test(value)) urls.push(value);
        else if (path.isAbsolute(value)) {
          const s = await lstat(value).catch(() => undefined);
          if (s?.isFile()) files.push(await register(value, path.basename(value)));
        }
      }
      return { sources: files, urls };
    },
  };
}
