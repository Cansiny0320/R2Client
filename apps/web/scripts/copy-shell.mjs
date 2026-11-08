import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const dist = new URL("../dist/client/", import.meta.url);
const html = await readFile(new URL("index.html", dist), "utf8");
const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attrs, body]) => !/(?:^|\s)src\s*=/.test(attrs) && body)
  .map(([, , body]) => "'sha256-" + createHash("sha256").update(body).digest("base64") + "'");
const csp =
  "default-src 'self'; script-src 'self' " +
  [...new Set(hashes)].join(" ") +
  "; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob: data:; media-src 'self' https: blob:; connect-src 'self' https: data: http://localhost:* http://127.0.0.1:*; frame-src https: blob:; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
await writeFile(
  new URL("_headers", dist),
  "/*\n  Content-Security-Policy: " +
    csp +
    "\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n",
);
