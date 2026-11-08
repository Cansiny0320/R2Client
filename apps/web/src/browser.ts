import { get, set } from "idb-keyval";
import { Engine, MiB, safeRelative } from "@r2client/core";
import type { Credentials, Driver, Item, Job, Source, SourceReader } from "@r2client/core";
import { createR2 } from "@r2client/s3";
import type { Platform } from "@r2client/ui";

type Folder = FileSystemDirectoryHandle & {
  queryPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
};
type Picker = Window & { showDirectoryPicker?(o: { mode: "readwrite" }): Promise<Folder> };
function fileSource(file: File, name = file.webkitRelativePath || file.name): SourceReader {
  return {
    id: crypto.randomUUID(),
    name,
    size: file.size,
    type: file.type,
    modified: file.lastModified,
    read: async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer()),
  };
}
function description({ id, name, size, type, modified }: SourceReader): Source {
  return { id, name, size, type, modified };
}

export function browserPlatform(): Platform {
  const secrets = new Map<string, Credentials>(),
    files = new Map<string, SourceReader>();
  let worker: Worker | undefined,
    sequence = 0;
  const writes = new Map<number, { resolve: (v: number) => void; reject: (e: Error) => void }>();
  const opfs = (id: string, op: "size" | "append" | "reset" | "remove", data?: Uint8Array) =>
    new Promise<number>((resolve, reject) => {
      if (!worker) {
        worker = new Worker(new URL("./opfs.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = ({ data }) => {
          const job = writes.get(data.request);
          writes.delete(data.request);
          if (data.error) job?.reject(new Error(data.error));
          else job?.resolve(data.result);
        };
        worker.onerror = () => {
          for (const job of writes.values())
            job.reject(new Error("Browser file storage is unavailable"));
          writes.clear();
          worker?.terminate();
          worker = undefined;
        };
      }
      const request = ++sequence;
      writes.set(request, { resolve, reject });
      worker.postMessage({ id, request, op, data });
    });
  async function target(destination: string, create: boolean) {
    const [root, relative] = JSON.parse(destination) as [string, string],
      segments = safeRelative(relative);
    let dir = await get<Folder>("folder:" + root);
    if (!dir) throw new Error("Choose the download directory again");
    if (dir.queryPermission && (await dir.queryPermission({ mode: "readwrite" })) !== "granted")
      throw new Error("Reauthorize the selected download directory in Transfers");
    const name = segments.pop()!;
    for (const s of segments) dir = (await dir.getDirectoryHandle(s, { create })) as Folder;
    return { dir, name };
  }
  const d: Driver = {
    platform: "web",
    store: (p, c) => createR2(p, c!),
    load: (k) => get("r2:" + k),
    save: (k, v) => set("r2:" + k, v),
    getSecret: async (id) => secrets.get(id),
    setSecret: async (id, c) => {
      if (c) secrets.set(id, c);
      else secrets.delete(id);
    },
    source: async (id) => files.get(id),
    disposeSource: async (id) => {
      files.delete(id);
    },
    async pickDestination() {
      const w = window as Picker;
      if (!w.showDirectoryPicker)
        throw new Error(
          "Use the download link or open this app in Chrome or Edge to download to a folder",
        );
      const dir = await w.showDirectoryPicker({ mode: "readwrite" });
      const entries = (await get<{ id: string; dir: Folder }[]>("r2:folders")) ?? [];
      const same = await Promise.all(
        entries.map(async (e) => ({ id: e.id, same: await e.dir.isSameEntry(dir) })),
      );
      const id = same.find((x) => x.same)?.id ?? crypto.randomUUID();
      await set("folder:" + id, dir);
      if (!entries.some((e) => e.id === id)) await set("r2:folders", [...entries, { id, dir }]);
      return id;
    },
    async fileMatches(destination: string, item: Item) {
      try {
        const { dir, name } = await target(destination, false),
          f = await (await dir.getFileHandle(name)).getFile();
        const m = await get<{ etag: string; size: number; modified: number }>(
          "downloaded:" + destination,
        );
        return (
          !!item.etag && m?.etag === item.etag && f.size === m.size && f.lastModified === m.modified
        );
      } catch {
        return false;
      }
    },
    async safeToReplace(destination: string) {
      try {
        const { dir, name } = await target(destination, false),
          f = await (await dir.getFileHandle(name)).getFile();
        const m = await get<{ size: number; modified: number }>("downloaded:" + destination);
        return !!m && f.size === m.size && f.lastModified === m.modified;
      } catch {
        return false;
      }
    },
    async sink(j: Job) {
      if (!j.destination) throw new Error("A download destination is required");
      const destination = j.destination;
      return {
        bytes: () => opfs(j.id, "size"),
        append: async (data) => {
          await opfs(j.id, "append", data);
        },
        reset: async () => {
          await opfs(j.id, "reset");
        },
        remove: async () => {
          await opfs(j.id, "remove");
        },
        async finish() {
          const { dir, name } = await target(destination, true);
          if (!j.replace) {
            try {
              await dir.getFileHandle(name);
              throw new Error("A local file already exists: " + name);
            } catch (e) {
              if ((e as Error).name !== "NotFoundError") throw e;
            }
          }
          const opDir = await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle("r2client-partial", { create: true });
          const op = await (await opDir.getFileHandle(j.id, { create: true })).getFile();
          const file = await dir.getFileHandle(name, { create: true }),
            writer = await file.createWritable();
          await op.stream().pipeTo(writer);
          const f = await file.getFile();
          if (j.etag)
            await set("downloaded:" + destination, {
              etag: j.etag,
              size: f.size,
              modified: f.lastModified,
            });
          await opfs(j.id, "remove");
        },
      };
    },
    async importUrls(urls) {
      const output: Source[] = [];
      for (const href of urls) {
        const u = new URL(href);
        const r = await fetch(u, {
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(60000),
        });
        if (!r.ok || !r.body) throw new Error("Could not download from " + u.hostname);
        const chunks: ArrayBuffer[] = [],
          reader = r.body.getReader();
        let size = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 100 * MiB) throw new Error("URL import is limited to 100 MB");
            chunks.push(Uint8Array.from(value).buffer);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        const name = decodeURIComponent(u.pathname.split("/").at(-1) || "download").replace(
          /[/\\]/g,
          "_",
        );
        const src = fileSource(
          new File(chunks, name, { type: r.headers.get("content-type") || "" }),
          name,
        );
        files.set(src.id, src);
        output.push(description(src));
      }
      return output;
    },
    async openExternal(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  };
  const api = new Engine(d);
  return {
    api,
    addFiles: async (input) => {
      const selected = input.map((entry) => {
        const src = fileSource(entry.file, entry.relative);
        files.set(src.id, src);
        return description(src);
      });
      await api.stage(selected);
    },
    attachFile: async (id, file) => {
      const src = fileSource(file);
      files.set(src.id, src);
      await api.attach(id, description(src));
    },
    capabilities: { folders: !!(window as Picker).showDirectoryPicker, desktop: false },
  };
}
