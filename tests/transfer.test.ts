import assert from "node:assert/strict";
import test from "node:test";
import { DemoStore } from "../packages/core/src/demo";
import {
  download,
  encodeKey,
  Engine,
  MiB,
  partSize,
  renamePlan,
  safeRelative,
  upload,
} from "../packages/core/src/index";
import type { Driver, Item, Job, SourceReader } from "../packages/core/src/index";
const signal = () => new AbortController().signal;
const originDate = "2026-11-08T00:00:00.000Z";
function local(name: string, bytes: Uint8Array): SourceReader {
  return {
    id: "source",
    name,
    modified: 1,
    size: bytes.length,
    type: "text/plain",
    async read(a, b) {
      return bytes.slice(a, b);
    },
  };
}
function job(source: SourceReader): Job {
  return {
    id: crypto.randomUUID(),
    profileId: "demo",
    key: source.name,
    state: "running",
    direction: "upload",
    done: 0,
    total: source.size,
    created: originDate,
    updated: originDate,
    partSize: 5 * MiB,
    source: {
      id: source.id,
      name: source.name,
      size: source.size,
      type: source.type,
      modified: source.modified,
    },
  };
}
function memoryDriver(store: DemoStore): Driver {
  const map = new Map<string, unknown>();
  return {
    platform: "web",
    store: () => store,
    load: async <T>(k: string) => map.get(k) as T | undefined,
    save: async (k, v) => {
      map.set(k, v);
    },
    getSecret: async () => undefined,
    setSecret: async () => {},
    source: async () => undefined,
    sink: async () => {
      throw new Error("not a download test");
    },
    importUrls: async () => [],
  };
}
test("large part sizing is bounded and conforms to the part count limit", () => {
  assert.equal(partSize(50 * 1024 * MiB), 32 * MiB);
  assert.ok(Math.ceil((5 * 1024 ** 4) / partSize(5 * 1024 ** 4)) <= 10000);
  assert.throws(() => partSize(5 * 1024 ** 4 + 1));
  assert.equal(
    encodeKey("照片 + (#1)/100%.png"),
    "%E7%85%A7%E7%89%87%20%2B%20%28%231%29/100%25.png",
  );
  assert.throws(() => safeRelative("prefix/../escape"));
  assert.throws(() => safeRelative("prefix/LPT1.txt"));
});
test("multipart resumes by reusing only matching recorded parts", async () => {
  const store = new DemoStore();
  const source = local("multipart.txt", new Uint8Array(5 * MiB + 89).fill(52));
  const transfer = job(source);
  const sends: number[] = [];
  const original = store.putPart.bind(store);
  let fail = true;
  store.putPart = async (...args) => {
    sends.push(args[2]);
    if (fail && args[2] === 2) throw new Error("connection dropped");
    return original(...args);
  };
  const checkpoints: Job[] = [];
  const save = async () => {
    checkpoints.push(structuredClone(transfer));
  };
  await assert.rejects(upload(transfer, source, store, save, signal()), /connection dropped/);
  assert.equal(transfer.parts?.length, 1);
  assert.equal(transfer.done, 5 * MiB);
  assert.ok(checkpoints[0]?.uploadId);
  fail = false;
  sends.length = 0;
  await upload(transfer, source, store, save, signal());
  assert.deepEqual(sends, [2]);
  assert.equal((await store.head(source.name)).size, source.size);
  assert.equal((await store.head(source.name)).metadata["r2client-job"], transfer.id);
  sends.length = 0;
  await upload(transfer, source, store, save, signal());
  assert.deepEqual(sends, []);
});
test("resume rejects altered bytes even if the file size and timestamp are unchanged", async () => {
  const store = new DemoStore(),
    source = local("changed.txt", new Uint8Array(5 * MiB + 2).fill(13)),
    transfer = job(source);
  const real = store.putPart.bind(store);
  store.putPart = async (...args) => {
    if (args[2] === 2) throw new Error("offline");
    return real(...args);
  };
  await assert.rejects(
    upload(transfer, source, store, async () => {}, signal()),
    /offline/,
  );
  store.putPart = real;
  const different = local("changed.txt", new Uint8Array(source.size).fill(17));
  await assert.rejects(
    upload(transfer, different, store, async () => {}, signal()),
    /contents changed/,
  );
  await assert.rejects(store.head(source.name), /NoSuchKey/);
});
test("download requests only the missing bytes and refuses a replaced source", async () => {
  const store = new DemoStore(),
    key = "range.txt";
  await store.put(key, new Uint8Array([1, 2, 3, 4, 5]), "text/plain", false);
  const row = await store.head(key),
    source = local(key, new Uint8Array(5));
  const transfer = { ...job(source), direction: "download" as const, etag: row.etag };
  const d = memoryDriver(store);
  const data = [1, 2],
    offsets: number[] = [];
  let finished = false;
  d.sink = async () => ({
    bytes: async () => data.length,
    append: async (b) => {
      data.push(...b);
    },
    finish: async () => {
      finished = true;
    },
    reset: async () => {},
    remove: async () => {},
  });
  const read = store.read.bind(store);
  store.read = async (...args) => {
    offsets.push(args[1] ?? 0);
    return read(...args);
  };
  await download(transfer, d, store, async () => {}, signal());
  assert.deepEqual(offsets, [2]);
  assert.deepEqual(data, [1, 2, 3, 4, 5]);
  assert.ok(finished);
  await store.put(key, new Uint8Array([9, 9, 9, 9, 9]), "text/plain", true);
  await assert.rejects(
    download(transfer, d, store, async () => {}, signal()),
    /Remote object changed/,
  );
  assert.deepEqual(data, [1, 2, 3, 4, 5]);
});
test("bulk plan rejects collisions and move preserves the source if copy fails", async () => {
  const engine = new Engine(memoryDriver(new DemoStore()));
  const source = "README.md";
  const copy = await engine.mutate("demo", [
    { kind: "copy", key: source, target: "documents/test.md" },
  ]);
  assert.equal(copy[0]?.ok, true);
  const results = await engine.mutate("demo", [
    { kind: "move", key: source, target: "documents/test.md" },
    { kind: "move", key: "documents/links.md", target: "other.md" },
  ]);
  assert.deepEqual(
    results.map((r) => r.ok),
    [false, true],
  );
  assert.match(results[0]?.error ?? "", /Destination already exists/);
  assert.equal((await engine.detail("demo", source)).key, source);
  assert.equal((await engine.detail("demo", "other.md")).key, "other.md");
  const found = await engine.duplicates("demo", "");
  assert.ok(found.some((group) => group.length === 2 && group.some((x) => x.key === source)));
  const objs: Item[] = ["a", "b"].map((key) => ({
    key: key + ".md",
    kind: "object",
    size: 0,
    modified: "",
  }));
  assert.throws(
    () => renamePlan(objs, { mode: "regex", text: "^[ab]", replacement: "same" }),
    /Conflicting rename/,
  );
});
test("finished uploads release their staged file handles, including skipped duplicates", async () => {
  const d = memoryDriver(new DemoStore());
  const first = local("first-release.txt", new TextEncoder().encode("release staged source"));
  const second = { ...first, id: "second", name: "duplicate.txt" };
  const files = new Map([first, second].map((file) => [file.id, file]));
  const released = new Set<string>();
  d.source = async (id) => files.get(id);
  d.disposeSource = async (id) => {
    released.add(id);
    files.delete(id);
  };
  const engine = new Engine(d);
  await engine.stage([first, second]);
  assert.equal(
    await engine.upload(
      "demo",
      "",
      [
        { id: first.id, name: first.name },
        { id: second.id, name: second.name },
      ],
      false,
      1,
      true,
    ),
    1,
  );
  const until = Date.now() + 1500;
  while (Date.now() < until && released.size < 2)
    await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual([...released].sort(), [first.id, second.id].sort());
  assert.equal((await engine.snapshot()).jobs[0]?.state, "completed");
});
test("document preview reads through the storage adapter and rejects mislabelled PDFs", async () => {
  const engine = new Engine(memoryDriver(new DemoStore()));
  const text = await engine.previewDocument("demo", "documents/guide.txt", "text");
  assert.match(new TextDecoder().decode(text), /Welcome to the R2Client demo/);
  await assert.rejects(engine.previewDocument("demo", "README.md", "pdf"), /not a valid PDF/);
});
