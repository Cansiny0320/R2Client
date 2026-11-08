import { errorText, notFound, partSize } from "./keys";
import type { Driver, Job, ObjectStore, Part, SourceReader } from "./model";

export async function sha256(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function missing(store: ObjectStore, key: string, signal?: AbortSignal) {
  try {
    return await store.head(key, signal);
  } catch (e) {
    if (!notFound(e)) throw e;
    return undefined;
  }
}
async function retry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let tries = 0; ; tries++) {
    signal.throwIfAborted();
    try {
      return await fn();
    } catch (error) {
      signal.throwIfAborted();
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (tries >= 2 || (status && status < 500 && ![408, 429].includes(status))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** tries));
    }
  }
}

export async function upload(
  job: Job,
  source: SourceReader,
  store: ObjectStore,
  save: () => Promise<void>,
  signal: AbortSignal,
) {
  if (job.source?.size !== source.size || job.source?.modified !== source.modified)
    throw new Error("Select the original file before resuming");
  const committed = async (error: unknown) => {
    if (signal.aborted) throw error;
    const actual = await missing(store, job.key, signal).catch(() => undefined);
    if (actual?.size !== job.total || actual.metadata["r2client-job"] !== job.id) throw error;
  };
  const prev = await missing(store, job.key, signal);
  if (prev?.size === job.total && prev.metadata["r2client-job"] === job.id) {
    job.done = job.total;
    return;
  }
  if (!job.replace && prev) throw new Error("An object with this name already exists");
  const type = source.type || "application/octet-stream",
    size = job.partSize ?? partSize(source.size);
  if (source.size <= size && !job.uploadId) {
    const data = await source.read(0, source.size);
    if (data.length !== source.size) throw new Error("Source file changed while reading");
    await retry(
      () => store.put(job.key, data, type, !!job.replace, signal, { "r2client-job": job.id }),
      signal,
    ).catch(committed);
    job.done = job.total;
    return;
  }
  if (!job.uploadId) {
    job.uploadId = await store.begin(job.key, type, job.id, signal);
    job.partSize = size;
    job.parts = [];
    await save();
  }
  const id = job.uploadId;
  let remote: Part[];
  try {
    remote = await store.parts(job.key, id, signal);
  } catch (e) {
    if ((e as { name?: string })?.name !== "NoSuchUpload") throw e;
    const completed = await missing(store, job.key, signal);
    if (completed?.size === job.total && completed.metadata["r2client-job"] === job.id) {
      job.done = job.total;
      return;
    }
    job.uploadId = undefined;
    job.parts = [];
    job.done = 0;
    await save();
    return upload(job, source, store, save, signal);
  }
  const local = new Map((job.parts ?? []).map((p) => [p.number, p]));
  const onR2 = new Map(remote.map((p) => [p.number, p.etag]));
  const accepted = new Map<number, Part>();
  const count = Math.ceil(source.size / size);
  let index = 1;
  let firstError: unknown;
  job.done = 0;
  await Promise.all(
    Array.from({ length: Math.min(count, 2) }, async () => {
      while (index <= count && !firstError) {
        try {
          signal.throwIfAborted();
          const number = index++,
            from = (number - 1) * size,
            to = Math.min(from + size, source.size);
          const data = await source.read(from, to);
          if (data.length !== to - from) throw new Error("Source file changed while reading");
          const digest = await sha256(data),
            before = local.get(number);
          if (before && before.digest !== digest)
            throw new Error("Source contents changed; cancel this job and create a new one");
          const etag =
            before && before.etag === onR2.get(number)
              ? before.etag
              : await retry(() => store.putPart(job.key, id, number, data, signal), signal);
          const part = { number, etag, digest, bytes: data.length };
          local.set(number, part);
          accepted.set(number, part);
          job.parts = Array.from(local.values());
          job.done += data.length;
          await save();
        } catch (e) {
          firstError ??= e;
        }
      }
    }),
  );
  if (firstError) throw firstError;
  signal.throwIfAborted();
  if (!job.replace && (await missing(store, job.key, signal)))
    throw new Error("The destination was created while uploading");
  await store
    .finish(
      job.key,
      id,
      [...accepted.values()].sort((a, b) => a.number - b.number),
      signal,
    )
    .catch(committed);
  job.done = job.total;
}

export async function download(
  job: Job,
  driver: Driver,
  store: ObjectStore,
  save: () => Promise<void>,
  signal: AbortSignal,
) {
  const sink = await driver.sink(job);
  const head = await store.head(job.key, signal);
  if (job.etag && job.etag !== head.etag)
    throw new Error("Remote object changed; start a new download");
  job.etag = head.etag;
  job.total = head.size;
  const offset = await sink.bytes();
  if (offset > head.size) throw new Error("Partial download exceeds remote object size");
  job.done = offset;
  await save();
  if (offset < head.size) {
    const response = await store.read(job.key, offset, head.etag, signal);
    if (
      response.length !== head.size - offset ||
      (response.etag && head.etag && response.etag !== head.etag)
    ) {
      await response.bytes.cancel();
      throw new Error("Unexpected range response; partial file was preserved");
    }
    const reader = response.bytes.getReader();
    let committed = job.done,
      lastFlush = Date.now();
    try {
      for (;;) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        await sink.append(value);
        job.done += value.length;
        if (job.done - committed >= 4 * 1024 * 1024 || Date.now() - lastFlush > 800) {
          await save();
          committed = job.done;
          lastFlush = Date.now();
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  signal.throwIfAborted();
  if (job.done !== head.size) throw new Error("Download ended early");
  await sink.finish();
}

export class Transfers {
  readonly jobs: Job[];
  private active = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  private pendingSave = Promise.resolve();
  private parallel = 2;
  constructor(
    private driver: Driver,
    private getStore: (id: string) => Promise<ObjectStore>,
    jobs: Job[],
    private onTerminal?: (job: Job) => Promise<void>,
  ) {
    this.jobs = jobs.map((j) =>
      j.state === "running" || j.state === "queued" ? { ...j, state: "paused" } : j,
    );
  }
  persist() {
    const snapshot = structuredClone(this.jobs);
    const pending = this.pendingSave.catch(() => {}).then(() => this.driver.save("jobs", snapshot));
    this.pendingSave = pending;
    return pending;
  }
  async add(jobs: Job[], concurrency?: number) {
    if (concurrency !== undefined)
      this.parallel = Math.max(1, Math.min(5, Math.trunc(concurrency) || 2));
    this.jobs.unshift(...jobs);
    await this.persist();
    this.pump();
  }
  private pump() {
    while (this.active.size < this.parallel) {
      const job = this.jobs.find((j) => j.state === "queued" && !this.active.has(j.id));
      if (!job) return;
      const abort = new AbortController();
      job.state = "running";
      const promise = this.run(job, abort.signal).finally(() => {
        this.active.delete(job.id);
        this.pump();
      });
      this.active.set(job.id, { abort, promise });
      void promise.catch(() => {});
    }
  }
  private async run(job: Job, signal: AbortSignal) {
    const save = () => {
      job.updated = new Date().toISOString();
      return this.persist();
    };
    try {
      await save();
      const store = await this.getStore(job.profileId);
      if (job.direction === "upload") {
        const source = job.source && (await this.driver.source(job.source.id));
        if (!source) throw new Error("Reselect the original upload file");
        await upload(job, source, store, save, signal);
      } else await download(job, this.driver, store, save, signal);
      job.state = "completed";
      job.error = undefined;
    } catch (e) {
      job.state = signal.aborted ? "paused" : "failed";
      job.error = signal.aborted ? undefined : errorText(e);
    }
    await save();
    if (job.state === "completed") await this.onTerminal?.(job);
  }
  async act(id: string, action: "pause" | "resume" | "cancel" | "remove") {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    if (action === "resume" && ["failed", "paused"].includes(j.state)) {
      j.state = "queued";
      j.error = undefined;
      await this.persist();
      this.pump();
      return;
    }
    if (action === "pause" && j.state === "queued") {
      j.state = "paused";
      await this.persist();
      return;
    }
    if (action === "pause" || action === "cancel") {
      if (j.state === "queued") j.state = "paused";
      const active = this.active.get(id);
      active?.abort.abort();
      await active?.promise;
      if (action === "pause" || ["completed", "cancelled"].includes(j.state)) return;
      try {
        if (j.uploadId) await (await this.getStore(j.profileId)).abort(j.key, j.uploadId);
        if (j.direction === "download") await (await this.driver.sink(j)).remove();
        j.state = "cancelled";
        j.error = undefined;
      } catch (e) {
        j.state = "failed";
        j.error = "Could not cancel: " + errorText(e);
      }
      await this.persist();
      if (j.state === "cancelled") await this.onTerminal?.(j);
      return;
    }
    if (action === "remove" && ["completed", "cancelled"].includes(j.state)) {
      this.jobs.splice(this.jobs.indexOf(j), 1);
      await this.persist();
    }
  }
  async clear() {
    for (let i = this.jobs.length - 1; i >= 0; i--)
      if (["completed", "cancelled"].includes(this.jobs[i]!.state)) this.jobs.splice(i, 1);
    await this.persist();
  }
}
