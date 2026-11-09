import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { Arch, Platform, build } from "electron-builder";

const exec = promisify(execFile);
const security = (args) => exec("/usr/bin/security", args);
const project = fileURLToPath(new URL("..", import.meta.url));
process.chdir(project);
const expected = JSON.parse(
  await readFile(new URL("./mac-signing-identity.json", import.meta.url)),
);
const { values } = parseArgs({
  options: {
    arch: { type: "string", default: process.arch },
    output: { type: "string", default: "release/local-signed" },
    dir: { type: "boolean" },
  },
});
if (process.platform !== "darwin" || !["arm64", "x64"].includes(values.arch))
  throw new Error("Fixed signing requires macOS arm64 or x64");
const directory =
  process.env.R2CLIENT_SIGNING_DIR ||
  path.join(homedir(), "Library/Application Support/R2Client Signing");
const identity = JSON.parse(await readFile(path.join(directory, "identity.json")));
const certificate = new X509Certificate(await readFile(path.join(directory, "certificate.cer")));
if (
  identity.name !== expected.name ||
  identity.sha1 !== expected.sha1 ||
  certificate.fingerprint.replaceAll(":", "") !== expected.sha1
)
  throw new Error("R2Client signing certificate does not match the pinned identity");
const password = (await readFile(path.join(directory, "keychain-password"), "utf8")).trim();
const output = path.resolve(values.output);
const keychains = async () =>
  (await security(["list-keychains", "-d", "user"])).stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.trim()));
let added = false;
try {
  await security(["unlock-keychain", "-p", password, identity.keychain]);
  const { stdout: identities } = await security([
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    identity.keychain,
  ]);
  if (!identities.includes(expected.sha1))
    throw new Error("R2Client signing identity is unavailable or not trusted for Code Signing");
  const list = await keychains();
  if (!list.includes(identity.keychain)) {
    await security(["list-keychains", "-d", "user", "-s", ...list, identity.keychain]);
    added = true;
  }
  delete process.env.CSC_LINK;
  delete process.env.CSC_KEY_PASSWORD;
  process.env.CSC_KEYCHAIN = identity.keychain;
  process.env.CSC_NAME = identity.name;
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  await build({
    targets: Platform.MAC.createTarget(values.dir ? ["dir"] : ["dmg", "zip"], Arch[values.arch]),
    publish: "never",
    config: {
      directories: { output },
      forceCodeSigning: true,
      mac: {
        identity: identity.name,
        hardenedRuntime: true,
        notarize: false,
        timestamp: "none",
        entitlements: "build/entitlements.mac.plist",
        entitlementsInherit: "build/entitlements.mac.plist",
      },
    },
  });
  const application = path.join(
    output,
    values.arch === "x64" ? "mac" : "mac-arm64",
    "R2Client.app",
  );
  await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", application]);
  const prefix = path.join(output, "signer-");
  await exec("/usr/bin/codesign", ["-d", `--extract-certificates=${prefix}`, application]);
  const signer = new X509Certificate(await readFile(prefix + "0"));
  if (signer.fingerprint !== certificate.fingerprint)
    throw new Error("Packaged application has the wrong signer");
  const { stdout, stderr } = await exec("/usr/bin/codesign", ["-d", "-r-", application]);
  const requirement = (stdout + stderr).split("\n").find((line) => line.includes("designated =>"));
  if (
    !requirement?.includes('identifier "top.cansiny.r2client"') ||
    !requirement.toUpperCase().includes(expected.sha1)
  )
    throw new Error("Packaged application is missing the persistent designated requirement");
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "local-signing.json"),
    JSON.stringify({ certificateSha1: expected.sha1, requirement, application }, null, 2) + "\n",
  );
  console.log(`Verified R2Client signer ${expected.sha1}`);
} catch (error) {
  console.error(String(error.message).replaceAll(password, "<redacted>"));
  process.exitCode = 1;
  process.on("exit", () => {
    process.exitCode = 1;
  });
} finally {
  if (added)
    await security([
      "list-keychains",
      "-d",
      "user",
      "-s",
      ...(await keychains()).filter((item) => item !== identity.keychain),
    ]);
  await security(["lock-keychain", identity.keychain]).catch(() => {});
}
