import { execFile } from "node:child_process";
import { randomBytes, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const exec = promisify(execFile);
const security = (args, admin = false) =>
  admin
    ? exec("/usr/bin/sudo", ["-n", "/usr/bin/security", ...args], { timeout: 60_000 })
    : exec("/usr/bin/security", args, { timeout: 60_000 });
const { values } = parseArgs({ options: { arch: { type: "string" } } });
if (
  process.platform !== "darwin" ||
  !["arm64", "x64"].includes(values.arch) ||
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.RUNNER_ENVIRONMENT !== "github-hosted" ||
  process.env.GITHUB_EVENT_NAME !== "push" ||
  !process.env.GITHUB_REF?.startsWith("refs/tags/v")
)
  throw new Error("Release signing requires a macOS GitHub-hosted runner on a version tag push");
const p12 = process.env.R2CLIENT_MAC_CERTIFICATE_P12;
const p12Password = process.env.R2CLIENT_MAC_CERTIFICATE_PASSWORD;
if (!p12 || !p12Password) throw new Error("R2Client release signing Secrets are missing");
const expected = JSON.parse(
  await readFile(new URL("./mac-signing-identity.json", import.meta.url)),
);
const project = fileURLToPath(new URL("..", import.meta.url));
const directory = await mkdtemp(
  path.join(process.env.RUNNER_TEMP || tmpdir(), "r2client-signing-"),
);
const keychain = path.join(directory, "ci.keychain-db");
const certificateFile = path.join(directory, "certificate.cer");
const password = randomBytes(32).toString("hex");
const redact = (message) =>
  [p12, p12Password, password].reduce(
    (text, secret) => text.replaceAll(secret, "<redacted>"),
    String(message),
  );
let created = false;
let trusted = false;
try {
  const p12File = path.join(directory, "identity.p12");
  await writeFile(p12File, Buffer.from(p12, "base64"), { mode: 0o600 });
  await security(["create-keychain", "-p", password, keychain]);
  created = true;
  await security(["set-keychain-settings", "-lut", "21600", keychain]);
  await security(["unlock-keychain", "-p", password, keychain]);
  await security([
    "import",
    p12File,
    "-k",
    keychain,
    "-P",
    p12Password,
    "-T",
    "/usr/bin/codesign",
    "-T",
    "/usr/bin/security",
  ]);
  await security([
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:,codesign:",
    "-s",
    "-k",
    password,
    keychain,
  ]);
  const { stdout } = await security(["find-certificate", "-c", expected.name, "-p", keychain]);
  const certificate = new X509Certificate(stdout);
  if (certificate.fingerprint.replaceAll(":", "") !== expected.sha1)
    throw new Error("Imported certificate does not match the pinned signing identity");
  await writeFile(certificateFile, certificate.raw, { mode: 0o600 });
  // Limit trust to Code Signing on the disposable runner.
  await security(
    [
      "add-trusted-cert",
      "-d",
      "-r",
      "trustRoot",
      "-p",
      "codeSign",
      "-k",
      keychain,
      certificateFile,
    ],
    true,
  );
  trusted = true;
  await writeFile(
    path.join(directory, "identity.json"),
    JSON.stringify({ ...expected, keychain }),
    { mode: 0o600 },
  );
  await writeFile(path.join(directory, "keychain-password"), password, { mode: 0o600 });
  const env = { ...process.env, R2CLIENT_SIGNING_DIR: directory };
  delete env.R2CLIENT_MAC_CERTIFICATE_P12;
  delete env.R2CLIENT_MAC_CERTIFICATE_PASSWORD;
  const result = await exec(
    process.execPath,
    ["scripts/package-mac-local.mjs", "--arch", values.arch, "--output", "release"],
    { cwd: project, env, maxBuffer: 8 * 1024 * 1024 },
  );
  process.stdout.write(redact(result.stdout));
  process.stderr.write(redact(result.stderr));
} catch (error) {
  console.error(redact(error.message));
  if (error.stderr) console.error(redact(error.stderr));
  process.exitCode = 1;
} finally {
  try {
    if (trusted) {
      await security(
        [
          "add-trusted-cert",
          "-d",
          "-r",
          "unspecified",
          "-p",
          "codeSign",
          "-k",
          keychain,
          certificateFile,
        ],
        true,
      );
      const { stdout } = await security(["find-identity", "-v", "-p", "codesigning", keychain]);
      if (stdout.includes(expected.sha1)) {
        console.error("CI signing identity remains trusted");
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(redact(error.message));
    process.exitCode = 1;
  } finally {
    try {
      if (created) await security(["delete-keychain", keychain]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
