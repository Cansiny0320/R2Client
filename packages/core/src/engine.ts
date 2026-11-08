import { sha256 as streamHash } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { DemoStore, demoProfile } from "./demo";
import {
  checkKey,
  checkProfile,
  errorText,
  joined,
  notFound,
  publicLink,
  safeRelative,
} from "./keys";
import type {
  Api,
  Connection,
  Driver,
  Index,
  Item,
  Job,
  Mutation,
  ObjectStore,
  Outcome,
  Preset,
  Profile,
  Schedule,
  Source,
} from "./model";
import { Transfers } from "./transfer";

const iso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const MAX_ACTIONS = 25_000;
const byteTotal = (objects: Item[]) => objects.reduce((n, x) => n + x.size, 0);
export async function listAll(store: ObjectStore, prefix = "") {
  const items: Item[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list(prefix, cursor, true);
    items.push(...page.items.filter((i) => i.kind === "object"));
    if (cursor && page.next === cursor) throw new Error("The R2 cursor stopped advancing");
    cursor = page.next;
  } while (cursor);
  return items;
}

export class Engine implements Api {
  private profiles: Profile[] = [];
  private staged: Source[] = [];
  private scheduled: Schedule[] = [];
  private scheduleTick = new Map<string, number>();
  private readonly demo = new DemoStore();
  private queues!: Transfers;
  private readonly initializing: Promise<void>;
  private readonly scans = new Map<string, Promise<Index>>();
  private readonly syncing = new Set<string>();
  constructor(private readonly driver: Driver) {
    this.initializing = this.init();
  }
  private async init() {
    const [profiles, stages, jobs, schedules] = await Promise.all([
      this.driver.load<Profile[]>("profiles"),
      this.driver.load<Source[]>("stages"),
      this.driver.load<Job[]>("jobs"),
      this.driver.load<Schedule[]>("schedules"),
    ]);
    this.profiles = profiles ?? [demoProfile];
    this.staged = stages ?? [];
    this.scheduled = schedules ?? [];
    this.queues = new Transfers(
      this.driver,
      (id) => this.bucket(id),
      jobs ?? [],
      async (job) => {
        if (job.source) await this.releaseIdleSource(job.source.id);
      },
    );
  }
  private async releaseIdleSource(id: string) {
    if (
      this.staged.some((s) => s.id === id) ||
      this.queues.jobs.some(
        (j) => j.source?.id === id && !["completed", "cancelled"].includes(j.state),
      )
    )
      return;
    await this.driver.disposeSource?.(id).catch(() => {});
  }
  private profile(id: string) {
    const p = this.profiles.find((p) => p.id === id);
    if (!p) throw new Error("Storage connection not found");
    return p;
  }
  private async bucket(id: string) {
    await this.initializing;
    const p = this.profile(id);
    if (p.demo) return this.demo;
    const c = await this.driver.getSecret(id);
    if (!c) throw new Error("Enter the bucket credentials to connect");
    return this.driver.store(p, c);
  }
  async snapshot() {
    await this.initializing;
    const connected = await Promise.all(
      this.profiles.map(async (p) => (p.demo || (await this.driver.getSecret(p.id)) ? p.id : "")),
    );
    return structuredClone({
      profiles: this.profiles,
      connected: connected.filter(Boolean),
      jobs: this.queues.jobs,
      stages: this.staged,
      platform: this.driver.platform,
    });
  }
  async connect(input: Connection) {
    await this.initializing;
    const { id, label, accountId, bucket, jurisdiction, publicBase, credentials, remember } = input;
    if (id && (!this.profiles.some((p) => p.id === id) || this.profile(id).demo))
      throw new Error("Unknown profile");
    const p: Profile = {
      id: id || uuid(),
      label: label.trim(),
      accountId: accountId.trim(),
      bucket: bucket.trim(),
      jurisdiction,
      publicBase: publicBase.trim(),
    };
    checkProfile(p);
    const old = id ? this.profile(id) : undefined;
    const changed =
      !!old &&
      (old.accountId !== p.accountId ||
        old.bucket !== p.bucket ||
        old.jurisdiction !== p.jurisdiction);
    if (changed) throw new Error("Add a separate connection for a different bucket");
    const c =
      credentials.accessKeyId.trim() && credentials.secretAccessKey.trim()
        ? {
            accessKeyId: credentials.accessKeyId.trim(),
            secretAccessKey: credentials.secretAccessKey.trim(),
            sessionToken: credentials.sessionToken?.trim() || undefined,
          }
        : id
          ? await this.driver.getSecret(id)
          : undefined;
    if (!c) throw new Error("An access key and secret key are required");
    await this.driver.store(p, c).list("");
    await this.driver.setSecret(p.id, c, !!remember);
    this.profiles = id ? this.profiles.map((v) => (v.id === id ? p : v)) : [...this.profiles, p];
    await this.driver.save("profiles", this.profiles);
  }
  async removeProfile(id: string) {
    await this.initializing;
    const jobs = this.queues.jobs.filter(
      (j) => j.profileId === id && !["completed", "cancelled"].includes(j.state),
    );
    if (jobs.length)
      throw new Error("Cancel or finish this bucket's transfers before removing its connection");
    this.profiles = this.profiles.filter((p) => p.id !== id);
    this.scheduled = this.scheduled.filter((s) => s.profileId !== id);
    await Promise.all([
      this.driver.setSecret(id, undefined, false),
      this.driver.save("profiles", this.profiles),
      this.driver.save("schedules", this.scheduled),
    ]);
  }
  async reorder(ids: string[]) {
    await this.initializing;
    if (new Set(ids).size !== ids.length || ids.length !== this.profiles.length)
      throw new Error("Invalid bucket order");
    this.profiles = ids.map((id) => this.profile(id));
    await this.driver.save("profiles", this.profiles);
  }
  async list(id: string, prefix: string, cursor?: string) {
    return (await this.bucket(id)).list(prefix, cursor);
  }
  async detail(id: string, key: string) {
    return (await this.bucket(id)).head(checkKey(key));
  }
  async previewDocument(id: string, key: string, format: "text" | "pdf") {
    if (format !== "text" && format !== "pdf") throw new Error("Unsupported preview format");
    const limit = format === "pdf" ? 32 * 1024 * 1024 : 512 * 1024;
    const store = await this.bucket(id);
    const detail = await store.head(checkKey(key));
    if (detail.size > limit)
      throw new Error("This document is too large to preview. Download it to open it.");
    const response = await store.read(key, 0, detail.etag);
    const reader = response.bytes.getReader();
    const bytes = new Uint8Array(detail.size);
    let at = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        if (at + part.value.length > bytes.length) throw new Error("Object changed during preview");
        bytes.set(part.value, at);
        at += part.value.length;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (at !== bytes.length) throw new Error("Object changed during preview");
    if (format === "pdf" && new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
      throw new Error("This object is not a valid PDF");
    }
    return bytes;
  }
  async index(id: string) {
    await this.initializing;
    return this.driver.load<Index>("index:" + this.profile(id).id);
  }
  async scan(id: string) {
    const before = this.scans.get(id);
    if (before) return before;
    const pending = this.scanBucket(id).finally(() => this.scans.delete(id));
    this.scans.set(id, pending);
    return pending;
  }
  private async scanBucket(id: string) {
    const store = await this.bucket(id),
      objects = await listAll(store);
    const updated = iso(),
      history = (await this.index(id))?.history ?? [];
    const row = { at: updated, count: objects.length, bytes: byteTotal(objects) };
    const index = {
      updated,
      objects,
      history: [...history.filter((h) => h.at.slice(0, 10) !== updated.slice(0, 10)), row].slice(
        -90,
      ),
    };
    await this.driver.save("index:" + id, index);
    return index;
  }
  private async hashObject(id: string, store: ObjectStore, item: Item) {
    const key = "hash:" + id + ":" + item.key;
    const old = item.etag ? await this.driver.load<{ etag: string; hash: string }>(key) : undefined;
    if (old && old.etag === item.etag) return old.hash;
    const response = await store.read(item.key, 0, item.etag);
    const reader = response.bytes.getReader(),
      h = streamHash.create();
    let bytes = 0;
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        h.update(r.value);
        bytes += r.value.length;
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (bytes !== item.size) throw new Error("Object changed during the scan: " + item.key);
    const hash = bytesToHex(h.digest());
    if (item.etag) await this.driver.save(key, { etag: item.etag, hash });
    return hash;
  }
  async duplicates(id: string, prefix: string) {
    const store = await this.bucket(id);
    const bySize = new Map<number, Item[]>();
    for (const item of await listAll(store, prefix)) {
      if (item.key.endsWith("/")) continue;
      const group = bySize.get(item.size) ?? [];
      group.push(item);
      bySize.set(item.size, group);
    }
    const byDigest = new Map<string, Item[]>();
    for (const candidates of bySize.values())
      if (candidates.length > 1)
        for (const item of candidates) {
          const hash = await this.hashObject(id, store, item);
          const group = byDigest.get(hash) ?? [];
          group.push(item);
          byDigest.set(hash, group);
        }
    return Array.from(byDigest.values()).filter((x) => x.length > 1);
  }
  async mutate(id: string, actions: Mutation[]) {
    const store = await this.bucket(id);
    const expanded: Mutation[] = [];
    for (const action of actions) {
      checkKey(action.key);
      if (action.kind !== "folder" && action.kind !== "metadata" && action.key.endsWith("/")) {
        if (action.target?.startsWith(action.key))
          throw new Error("Cannot copy or move a folder into itself");
        for (const row of await listAll(store, action.key))
          expanded.push({
            ...action,
            key: row.key,
            expectedEtag: row.etag,
            target: action.target
              ? joined(action.target, row.key.slice(action.key.length))
              : undefined,
          });
      } else expanded.push(action);
      if (expanded.length > MAX_ACTIONS)
        throw new Error("Split the selection into batches of 25,000 or fewer");
    }
    const results: Outcome[] = [];
    const done = new Set<string>();
    for (const a of expanded) {
      if (done.has(a.kind + "|" + a.key)) continue;
      done.add(a.kind + "|" + a.key);
      try {
        if (a.kind === "folder") {
          const key = a.key.endsWith("/") ? a.key : a.key + "/";
          await store.put(checkKey(key), new Uint8Array(0), "application/x-directory", false);
        } else {
          const source = await store.head(a.key);
          if (a.expectedEtag && a.expectedEtag !== source.etag)
            throw new Error("Source changed since selection");
          if (a.kind === "delete") await store.remove(a.key, source.etag);
          else if (a.kind === "metadata") {
            await store.copy(a.key, a.key, source.etag, {
              ...source,
              metadata: { ...source.metadata, ...a.metadata },
              type: a.type ?? source.type,
              cacheControl: a.cacheControl ?? source.cacheControl,
              disposition: a.disposition ?? source.disposition,
            });
          } else {
            const target = checkKey(a.target ?? "");
            if (target === a.key) throw new Error("Destination must differ from source");
            try {
              await store.head(target);
              throw new Error("Destination already exists");
            } catch (e) {
              if (!notFound(e)) throw e;
            }
            await store.copy(a.key, target, source.etag);
            if (a.kind === "move") {
              try {
                if ((await store.head(a.key)).etag !== source.etag)
                  throw new Error("Source changed during the copy");
                await store.remove(a.key, source.etag);
              } catch (e) {
                throw new Error("Copied, but source was retained: " + errorText(e));
              }
            }
          }
        }
        results.push({ key: a.key, target: a.target, ok: true });
      } catch (e) {
        results.push({ key: a.key, target: a.target, ok: false, error: errorText(e) });
      }
    }
    return results;
  }
  async links(
    id: string,
    key: string,
    seconds: number,
    mode: "public" | "signed" | "preview" | "download",
  ) {
    const store = await this.bucket(id);
    if (mode === "public") return publicLink(this.profile(id).publicBase, key);
    const age = Math.max(1, Math.min(604800, Math.trunc(seconds) || 3600));
    const url = await store.signed(
      checkKey(key),
      age,
      mode === "download" ? key.split("/").at(-1) : undefined,
    );
    return mode === "preview" && this.driver.mediaUrl ? this.driver.mediaUrl(id, key, url) : url;
  }
  async stage(sources: Source[]) {
    await this.initializing;
    for (const s of sources) {
      const src = await this.driver.source(s.id);
      if (!src) throw new Error("File was not selected or has expired");
      const { id, name, size, type, modified } = src;
      if (!this.staged.some((x) => x.id === id))
        this.staged.push({ id, name, size, type, modified });
    }
    await this.driver.save("stages", this.staged);
  }
  async pickSources(directory: boolean) {
    if (this.driver.pickSources) await this.stage(await this.driver.pickSources(directory));
  }
  async importUrls(urls: string[]) {
    const unique = [...new Set(urls)].slice(0, 100);
    for (const s of unique) {
      const u = new URL(s);
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
        throw new Error("Enter public HTTP or HTTPS file URLs");
    }
    await this.stage(await this.driver.importUrls(unique));
  }
  async unstage(id: string) {
    await this.initializing;
    this.staged = this.staged.filter((s) => s.id !== id);
    await this.driver.save("stages", this.staged);
    await this.releaseIdleSource(id);
  }
  async upload(
    id: string,
    prefix: string,
    entries: { id: string; name: string }[],
    replace: boolean,
    concurrency: number,
    skipDuplicates = false,
  ) {
    const store = await this.bucket(id);
    const time = iso(),
      jobs: Job[] = [],
      keys = new Set<string>(),
      stagedHashes = new Set<string>();
    const objects = skipDuplicates ? await listAll(store, prefix) : [];
    let skipped = 0;
    for (const entry of entries) {
      const source = this.staged.find((s) => s.id === entry.id),
        key = joined(prefix, entry.name);
      const reader = source && (await this.driver.source(source.id));
      if (!source || !reader) throw new Error("Reselect this file: " + entry.name);
      if (skipDuplicates) {
        const hash = streamHash.create(),
          chunk = 8 * 1024 * 1024;
        for (let i = 0; i < reader.size; i += chunk) {
          const end = Math.min(i + chunk, reader.size),
            data = await reader.read(i, end);
          if (data.length !== end - i) throw new Error("Source file changed while reading");
          hash.update(data);
        }
        const digest = bytesToHex(hash.digest());
        let duplicate = stagedHashes.has(digest);
        if (!duplicate)
          for (const item of objects)
            if (
              item.size === reader.size &&
              !item.key.endsWith("/") &&
              (await this.hashObject(id, store, item)) === digest
            ) {
              duplicate = true;
              break;
            }
        if (duplicate) {
          skipped++;
          continue;
        }
        stagedHashes.add(digest);
      }
      if (keys.has(key)) throw new Error("Duplicate upload target: " + key);
      keys.add(key);
      jobs.push({
        id: uuid(),
        profileId: id,
        key,
        direction: "upload",
        state: "queued",
        source: { ...source },
        replace,
        total: source.size,
        done: 0,
        created: time,
        updated: time,
      });
    }
    await this.queues.add(jobs, concurrency);
    this.staged = this.staged.filter((s) => !entries.some((e) => e.id === s.id));
    await this.driver.save("stages", this.staged);
    for (const { id } of entries) await this.releaseIdleSource(id);
    return skipped;
  }
  async download(id: string, keys: Item[], directory: string, prefix: string, replace: boolean) {
    const store = await this.bucket(id),
      unique = new Map<string, Item>();
    if (!directory) throw new Error("Select a download folder");
    for (const item of keys) {
      if (item.kind === "folder")
        for (const row of await listAll(store, item.key)) unique.set(row.key, row);
      else unique.set(item.key, item);
    }
    const time = iso(),
      jobs: Job[] = [],
      ignored: string[] = [];
    const claimed = new Set(
      this.queues.jobs
        .filter((j) => j.direction === "download" && !["completed", "cancelled"].includes(j.state))
        .map((j) => j.destination),
    );
    for (const item of unique.values()) {
      if (item.key.endsWith("/")) continue;
      const relative = item.key.startsWith(prefix) ? item.key.slice(prefix.length) : item.key;
      try {
        safeRelative(relative);
      } catch {
        ignored.push(item.key);
        continue;
      }
      const destination = JSON.stringify([directory, relative]);
      if (claimed.has(destination)) continue;
      claimed.add(destination);
      jobs.push({
        id: uuid(),
        profileId: id,
        key: item.key,
        direction: "download",
        state: "queued",
        destination,
        etag: item.etag,
        replace,
        total: item.size,
        done: 0,
        created: time,
        updated: time,
      });
    }
    await this.queues.add(jobs);
    if (ignored.length)
      throw new Error(
        ignored.length + " object keys cannot be saved as local paths. First: " + ignored[0],
      );
  }
  async pickDestination() {
    return this.driver.pickDestination?.();
  }
  async attach(id: string, source: Source) {
    await this.initializing;
    const job = this.queues.jobs.find((j) => j.id === id);
    const src = await this.driver.source(source.id);
    if (
      !job?.source ||
      !src ||
      job.source.size !== src.size ||
      job.source.modified !== src.modified
    )
      throw new Error("Choose the original file");
    const previous = job.source.id;
    job.source = { ...job.source, id: src.id };
    await this.queues.persist();
    await this.releaseIdleSource(previous);
  }
  async job(id: string, action: "pause" | "resume" | "cancel" | "remove") {
    await this.initializing;
    await this.queues.act(id, action);
  }
  async clearCompleted() {
    await this.initializing;
    await this.queues.clear();
  }
  async schedules() {
    await this.initializing;
    return structuredClone(this.scheduled);
  }
  async schedule(value: Schedule) {
    await this.initializing;
    if (this.driver.platform !== "desktop") throw new Error("Scheduled sync is a desktop feature");
    this.profile(value.profileId);
    if (
      !value.destination ||
      !Number.isInteger(value.minutes) ||
      value.minutes < 5 ||
      value.minutes > 10080
    )
      throw new Error("Set a folder and an interval from 5 to 10,080 minutes");
    this.scheduled = [
      ...this.scheduled.filter((s) => s.profileId !== value.profileId || s.prefix !== value.prefix),
      value,
    ];
    this.scheduleTick.set(value.profileId + ":" + value.prefix, Date.now());
    await this.driver.save("schedules", this.scheduled);
  }
  async syncDirectory(id: string, prefix: string, directory: string) {
    const stamp = id + ":" + prefix;
    if (this.syncing.has(stamp)) return 0;
    this.syncing.add(stamp);
    try {
      const items = await listAll(await this.bucket(id), prefix),
        pending: Item[] = [],
        updates: Item[] = [];
      for (const item of items) {
        if (item.key.endsWith("/")) continue;
        const relative = item.key.slice(prefix.length);
        try {
          safeRelative(relative);
        } catch {
          continue;
        }
        const destination = JSON.stringify([directory, relative]);
        if (await this.driver.fileMatches?.(destination, item)) continue;
        if (await this.driver.safeToReplace?.(destination)) updates.push(item);
        else pending.push(item);
      }
      await this.download(id, pending, directory, prefix, false);
      await this.download(id, updates, directory, prefix, true);
      return pending.length + updates.length;
    } finally {
      this.syncing.delete(stamp);
    }
  }
  async tick() {
    await this.initializing;
    for (const s of this.scheduled) {
      const key = s.profileId + ":" + s.prefix,
        last = this.scheduleTick.get(key) ?? 0;
      if (s.enabled && Date.now() - last >= s.minutes * 60000) {
        this.scheduleTick.set(key, Date.now());
        await this.syncDirectory(s.profileId, s.prefix, s.destination).catch(() => {});
      }
    }
  }
  async convert(id: string, preset: Preset, keepOriginal = false) {
    if (!this.driver.convert) throw new Error("Media conversion is available in the desktop app");
    await this.stage([await this.driver.convert(id, preset)]);
    if (!keepOriginal) await this.unstage(id);
  }
  async ffmpegStatus() {
    return (await this.driver.ffmpegStatus?.()) ?? { available: false };
  }
  async configureFfmpeg() {
    await this.driver.configureFfmpeg?.();
  }
  async revealDestination(id: string) {
    await this.driver.revealDestination?.(id);
  }
  async openExternal(url: string) {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      throw new Error("Invalid external URL");
    await this.driver.openExternal?.(u.href);
  }
}
