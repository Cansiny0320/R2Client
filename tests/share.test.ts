import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const shareRequire = createRequire(new URL("../apps/share/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
interface TestMiniflare {
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>;
  getD1Database(name: string): Promise<import("../apps/share/src/index").Env["DB"]>;
  dispose(): Promise<void>;
}
const { Miniflare, Response: WorkerResponse } = shareRequire("miniflare") as {
  Miniflare: new (options: {
    modules: boolean;
    script: string;
    compatibilityDate: string;
    d1Databases: Record<string, string>;
    bindings: Record<string, string>;
    ratelimits: Record<string, { namespace_id: string; simple: { limit: number; period: number } }>;
    outboundService: (request: Request) => Promise<Response>;
  }) => TestMiniflare;
  Response: typeof Response;
};
const { build } = desktopRequire(
  "esbuild",
) as typeof import("../apps/desktop/node_modules/esbuild");
const admin = "test-admin-" + randomBytes(32).toString("hex"),
  key = randomBytes(32).toString("base64url");
const password = "correct-test-password",
  hostname = "0".repeat(32) + ".r2.cloudflarestorage.com";
function date() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
function source(host = hostname) {
  return (
    "https://" +
    host +
    "/bucket/fake.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=" +
    date() +
    "&X-Amz-Expires=900&X-Amz-Credential=fixture&X-Amz-SignedHeaders=host&X-Amz-Signature=" +
    "a".repeat(64)
  );
}
test("password shares are authenticated, ranged, encrypted, rate limited and revocable", async (t) => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../apps/share/src/index.ts", import.meta.url))],
    write: false,
    bundle: true,
    format: "esm",
    target: "es2023",
  });
  const calls: { host: string; range: string | null }[] = [];
  const worker = new Miniflare({
    modules: true,
    script: result.outputFiles[0]!.text,
    compatibilityDate: "2026-07-30",
    d1Databases: { DB: "r2client-test" },
    bindings: {
      SHARE_ADMIN_TOKEN: admin,
      SHARE_ENCRYPTION_KEY: key,
      ALLOWED_ORIGINS: "https://app.example.test",
    },
    ratelimits: {
      ISSUE_LIMIT: { namespace_id: "141", simple: { limit: 60, period: 60 } },
      UNLOCK_LIMIT: { namespace_id: "142", simple: { limit: 8, period: 60 } },
    },
    outboundService: async (req) => {
      calls.push({ host: new URL(req.url).hostname, range: req.headers.get("range") });
      if (req.headers.get("range") === "bytes=1-2")
        return new WorkerResponse(null, {
          status: 302,
          headers: { Location: "https://example.test/blocked" },
        });
      return new WorkerResponse("456", {
        status: 206,
        headers: {
          "Content-Length": "3",
          "Content-Range": "bytes 4-6/10",
          "Accept-Ranges": "bytes",
        },
      });
    },
  });
  t.after(() => worker.dispose());
  const db = await worker.getD1Database("DB");
  const schema = (
    await readFile(new URL("../apps/share/migrations/0001_shares.sql", import.meta.url), "utf8")
  )
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  await db.batch(schema.map((s) => db.prepare(s)));
  const fetch = (path: string, init?: Parameters<typeof worker.dispatchFetch>[1]) =>
    worker.dispatchFetch("https://shares.example.test" + path, init);
  const issue = (token: string, url = source()) =>
    fetch("/api/shares", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Origin: "https://app.example.test",
      },
      body: JSON.stringify({ url, name: "A <test>.txt", password, seconds: 900 }),
    });
  assert.equal((await issue("wrong")).status, 401);
  assert.equal((await issue(admin, source("example.test"))).status, 400);
  const r = await issue(admin);
  assert.equal(r.status, 201);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://app.example.test");
  const row = (await r.json()) as { id: string };
  const stored = await db.prepare("SELECT * FROM shares WHERE id=?").bind(row.id).first();
  assert.ok(stored);
  assert.doesNotMatch(JSON.stringify(stored), /X-Amz|correct-test-password|fixture/);
  const path = "/s/" + row.id;
  assert.equal((await fetch(path + "/file")).status, 401);
  assert.match(await (await fetch(path)).text(), /A &lt;test&gt;\.txt/);
  const unlock = (value: string, ip = "192.0.2.10") =>
    fetch(path, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://shares.example.test",
        "CF-Connecting-IP": ip,
      },
      body: new URLSearchParams({ password: value }).toString(),
    });
  assert.equal((await unlock("wrong")).status, 401);
  const opened = await unlock(password);
  assert.equal(opened.status, 303);
  const cookie = opened.headers.get("Set-Cookie")!.split(";")[0]!;
  assert.match(opened.headers.get("Set-Cookie")!, /HttpOnly; Secure; SameSite=Strict/);
  const file = await fetch(path + "/file", { headers: { Cookie: cookie, Range: "bytes=4-6" } });
  assert.equal(file.status, 206);
  assert.equal(await file.text(), "456");
  assert.equal(file.headers.get("Content-Range"), "bytes 4-6/10");
  assert.match(file.headers.get("Content-Disposition") ?? "", /attachment/);
  assert.deepEqual(calls, [{ host: hostname, range: "bytes=4-6" }]);
  assert.equal(
    (await fetch(path + "/file", { headers: { Cookie: cookie, Range: "bytes=1-2" } })).status,
    502,
  );
  assert.deepEqual(calls.at(-1), { host: hostname, range: "bytes=1-2" });
  for (let i = 0; i < 8; i++) await (await unlock("wrong", "192.0.2.50")).text();
  assert.equal((await unlock("wrong", "192.0.2.50")).status, 429);
  await db.prepare("UPDATE shares SET expires=0 WHERE id=?").bind(row.id).run();
  assert.equal((await fetch(path + "/file", { headers: { Cookie: cookie } })).status, 404);
  await db.prepare("UPDATE shares SET expires=9999999999 WHERE id=?").bind(row.id).run();
  assert.equal(
    (
      await fetch("/api/shares/" + row.id, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + admin },
      })
    ).status,
    204,
  );
  assert.equal((await fetch(path + "/file", { headers: { Cookie: cookie } })).status, 404);
  assert.equal(calls.length, 2);
});
