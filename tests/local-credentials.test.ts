import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { localCredentials } from "../apps/desktop/src/local-credentials";

test(
  "local credentials survive restart in private files and can be forgotten",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "r2client-credentials-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const directory = path.join(root, "credentials");
    const id = "fixture-account";
    const saved = {
      accessKeyId: "fixture-id",
      secretAccessKey: "fixture-secret",
      sessionToken: "fixture-session",
    };
    const store = localCredentials(directory);
    assert.equal(await store.get(id), undefined);
    await store.set(id, saved);
    const restarted = localCredentials(directory);
    assert.deepEqual(await restarted.get(id), saved);
    assert.equal(await restarted.get("different-account"), undefined);
    const [name] = await readdir(directory);
    const file = path.join(directory, name);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await chmod(file, 0o644);
    await assert.rejects(restarted.get(id), /Could not read local credentials/);
    await restarted.set(id, undefined);
    assert.equal(await localCredentials(directory).get(id), undefined);
  },
);
