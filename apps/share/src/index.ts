import type { D1Database, RateLimit } from "@cloudflare/workers-types";
export interface Env {
  DB: D1Database;
  UNLOCK_LIMIT: RateLimit;
  ISSUE_LIMIT: RateLimit;
  ALLOWED_ORIGINS: string;
  SHARE_ADMIN_TOKEN: string;
  SHARE_ENCRYPTION_KEY: string;
}
type Row = {
  id: string;
  name: string;
  ciphertext: string;
  iv: string;
  salt: string;
  verifier: string;
  expires: number;
};
const encoder = new TextEncoder(),
  decoder = new TextDecoder(),
  MAX_EXPIRY = 604800;
const now = () => Math.floor(Date.now() / 1000);
const knownR2 = /^[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/i;
const identity = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const frame = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
};
function base64(a: ArrayBuffer | Uint8Array) {
  return btoa(
    Array.from(a instanceof Uint8Array ? a : new Uint8Array(a), (b) => String.fromCharCode(b)).join(
      "",
    ),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function unbase64(s: string) {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const sha = (s: string) => crypto.subtle.digest("SHA-256", encoder.encode(s));
const safeEq = (a: ArrayBuffer, b: ArrayBuffer) =>
  (
    crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean }
  ).timingSafeEqual(a, b);
const equals = async (a: string, b: string) => safeEq(await sha(a), await sha(b));
function assertConfigured(env: Env) {
  if (
    !env.SHARE_ADMIN_TOKEN ||
    env.SHARE_ADMIN_TOKEN.length < 32 ||
    !env.SHARE_ENCRYPTION_KEY ||
    unbase64(env.SHARE_ENCRYPTION_KEY).length !== 32
  )
    throw new Error("Share service not configured");
}
async function aes(env: Env) {
  return crypto.subtle.importKey(
    "raw",
    await sha("r2client:encrypt:" + env.SHARE_ENCRYPTION_KEY),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
async function hmac(env: Env, purpose: string, input: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    await sha("r2client:" + purpose + ":" + env.SHARE_ENCRYPTION_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, encoder.encode(input));
}
async function verifier(env: Env, password: string, salt: Uint8Array<ArrayBuffer>) {
  const peppered = await hmac(env, "password", password);
  const key = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const value = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    key,
    256,
  );
  return base64(value);
}
function validUpstream(input: string) {
  if (input.length > 8192) throw new Error("Invalid source");
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !knownR2.test(url.hostname) ||
    !/^\/[^/]+\/.+/.test(url.pathname)
  )
    throw new Error("Invalid source");
  const p = url.searchParams,
    d = p.get("X-Amz-Date") ?? "",
    sign = p.get("X-Amz-Signature") ?? "",
    signed = p.get("X-Amz-SignedHeaders");
  if (
    p.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
    !p.get("X-Amz-Credential") ||
    !/[a-f0-9]{64}/i.test(sign) ||
    sign.length !== 64 ||
    signed !== "host" ||
    !/^\d{8}T\d{6}Z$/.test(d)
  )
    throw new Error("Invalid signature");
  if (["uploads", "uploadId", "partNumber", "list-type", "prefix", "delete"].some((k) => p.has(k)))
    throw new Error("Not a single object URL");
  const date =
    Date.parse(
      d.slice(0, 4) +
        "-" +
        d.slice(4, 6) +
        "-" +
        d.slice(6, 8) +
        "T" +
        d.slice(9, 11) +
        ":" +
        d.slice(11, 13) +
        ":" +
        d.slice(13, 15) +
        "Z",
    ) / 1000;
  const expires = Number(p.get("X-Amz-Expires"));
  if (
    !Number.isFinite(date) ||
    !Number.isInteger(expires) ||
    expires < 1 ||
    expires > MAX_EXPIRY ||
    date > now() + 300 ||
    date + expires <= now()
  )
    throw new Error("Expired source");
  return { url, expires: date + expires };
}
async function smallBody(r: Request, limit = 16 * 1024) {
  const length = Number(r.headers.get("content-length") || 0);
  if (length > limit) throw new Error("Request too large");
  if (!r.body) return "";
  const reader = r.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const v = await reader.read();
      if (v.done) break;
      bytes += v.value.length;
      if (bytes > limit) throw new Error("Request too large");
      chunks.push(v.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const out = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return decoder.decode(out);
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...frame, "Content-Type": "application/json; charset=utf-8" },
  });
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
function page(row: Row, error = "", status = 200) {
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>R2Client 路 Protected file</title><style>body{background:#f8f7f5;color:#242226;font:16px system-ui;display:grid;place-items:center;min-height:95vh;margin:0}main{background:white;border:1px solid #e6e2de;padding:26px;border-radius:12px;width:min(360px,80vw)}h1{font-size:20px;overflow-wrap:anywhere}label,input,button{display:block}input,button{box-sizing:border-box;width:100%;padding:10px;margin:8px 0;border:1px solid #c9c4c0;border-radius:7px;font:inherit}button{background:#d76225;color:white;cursor:pointer}p{color:#a32f42}</style><main><strong>R2Client</strong><h1>' +
      escape(row.name) +
      "</h1>" +
      (error ? '<p role="alert">' + escape(error) + "</p>" : "") +
      '<form method="post"><label for="password">Share password</label><input id="password" name="password" type="password" required maxlength="256" autocomplete="current-password"><button>Download file</button></form></main></html>',
    {
      status,
      headers: {
        ...frame,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      },
    },
  );
}
function cors(response: Response, origin: string, env: Env) {
  if (
    !origin ||
    !env.ALLOWED_ORIGINS.split(",")
      .map((x) => x.trim())
      .includes(origin)
  )
    return response;
  const h = new Headers(response.headers);
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  h.set("Access-Control-Max-Age", "300");
  return new Response(response.body, { status: response.status, headers: h });
}
async function admin(req: Request, url: URL, env: Env) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: frame });
  assertConfigured(env);
  const auth = req.headers.get("Authorization") ?? "";
  if (auth.length > 1024 || !(await equals(auth, "Bearer " + env.SHARE_ADMIN_TOKEN)))
    return json({ error: "unauthorized" }, 401);
  if (!(await env.ISSUE_LIMIT.limit({ key: "share-management" })).success)
    return json({ error: "rate_limited" }, 429);
  if (req.method === "POST" && url.pathname === "/api/shares") {
    try {
      const data = JSON.parse(await smallBody(req)) as {
        url?: string;
        name?: string;
        password?: string;
        seconds?: number;
      };
      if (
        typeof data.url !== "string" ||
        typeof data.name !== "string" ||
        typeof data.password !== "string" ||
        data.password.length < 8 ||
        data.password.length > 256 ||
        !data.name ||
        data.name.length > 255 ||
        !Number.isInteger(data.seconds) ||
        data.seconds! < 1 ||
        data.seconds! > MAX_EXPIRY
      )
        return json({ error: "invalid_share" }, 400);
      const signed = validUpstream(data.url),
        expires = Math.min(signed.expires, now() + data.seconds!),
        id = crypto.randomUUID();
      const iv = random(12),
        salt = random(16);
      const cipher = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: encoder.encode(id) },
        await aes(env),
        encoder.encode(signed.url.href),
      );
      const hash = await verifier(env, data.password, salt);
      await env.DB.prepare(
        "INSERT INTO shares (id,name,ciphertext,iv,salt,verifier,expires) VALUES (?,?,?,?,?,?,?)",
      )
        .bind(id, data.name, base64(cipher), base64(iv), base64(salt), hash, expires)
        .run();
      return json(
        {
          id,
          name: data.name,
          link: url.origin + "/s/" + id,
          expires: new Date(expires * 1000).toISOString(),
        },
        201,
      );
    } catch (e) {
      if (
        e instanceof SyntaxError ||
        e instanceof TypeError ||
        (e instanceof Error && /Invalid |Expired |Not a single|too large/.test(e.message))
      )
        return json({ error: "invalid_share" }, 400);
      throw e;
    }
  }
  const id = url.pathname.split("/").at(-1) ?? "";
  if (req.method === "DELETE" && identity.test(id)) {
    await env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(id).run();
    return new Response(null, { status: 204, headers: frame });
  }
  return json({ error: "not_found" }, 404);
}
async function share(req: Request, url: URL, env: Env) {
  const [, , id = "", leaf = ""] = url.pathname.split("/");
  if (!identity.test(id) || (leaf && leaf !== "file") || url.pathname.split("/").length > 4)
    return json({ error: "not_found" }, 404);
  assertConfigured(env);
  const row = await env.DB.prepare("SELECT * FROM shares WHERE id = ? AND expires > ?")
    .bind(id, now())
    .first<Row>();
  if (!row) return json({ error: "expired_or_revoked" }, 404);
  if (!leaf && req.method === "GET") return page(row);
  if (!leaf && req.method === "POST") {
    if (req.headers.get("origin") !== url.origin) return json({ error: "invalid_origin" }, 403);
    const key = id + ":" + (req.headers.get("CF-Connecting-IP") ?? "local");
    if (!(await env.UNLOCK_LIMIT.limit({ key })).success)
      return page(row, "Too many attempts. Try again in a minute.", 429);
    let password = "";
    try {
      password = new URLSearchParams(await smallBody(req, 2048)).get("password") ?? "";
    } catch {
      return page(row, "Invalid password.", 400);
    }
    if (
      !password ||
      password.length > 256 ||
      !(await equals(row.verifier, await verifier(env, password, unbase64(row.salt))))
    )
      return page(row, "Incorrect password.", 401);
    const until = Math.min(now() + 900, row.expires),
      signed = base64(await hmac(env, "session", id + ":" + until));
    return new Response(null, {
      status: 303,
      headers: {
        ...frame,
        Location: "/s/" + id + "/file",
        "Set-Cookie":
          "r2share=" +
          until +
          "." +
          signed +
          "; Path=/s/" +
          id +
          "; Max-Age=" +
          (until - now()) +
          "; HttpOnly; Secure; SameSite=Strict",
      },
    });
  }
  if (leaf !== "file" || req.method !== "GET") return json({ error: "not_found" }, 404);
  const cookie =
    req.headers
      .get("Cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("r2share="))
      ?.slice(8) ?? "";
  const [until, sig] = cookie.split(".");
  if (
    !sig ||
    !/^\d{10}$/.test(until ?? "") ||
    +until! <= now() ||
    +until! > row.expires ||
    !(await equals(sig, base64(await hmac(env, "session", id + ":" + until))))
  )
    return json({ error: "password_required" }, 401);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unbase64(row.iv), additionalData: encoder.encode(id) },
    await aes(env),
    unbase64(row.ciphertext),
  );
  const upstream = validUpstream(decoder.decode(decrypted)).url;
  const headers = new Headers(),
    range = req.headers.get("Range");
  if (range) {
    if (!/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return json({ error: "invalid_range" }, 416);
    headers.set("Range", range);
  }
  const r = await fetch(upstream, {
    headers,
    redirect: "manual",
    cf: { cacheTtl: 0 },
  } as RequestInit);
  if (!r.ok && r.status !== 416) {
    await r.body?.cancel();
    return json({ error: "file_unavailable" }, r.status === 404 ? 404 : 502);
  }
  const resultHeaders = new Headers({
    ...frame,
    "Content-Type": "application/octet-stream",
    "Content-Disposition":
      "attachment; filename*=UTF-8''" +
      encodeURIComponent(row.name.replace(/[\r\n]/g, "")).replace(
        /[!'()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16),
      ),
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  for (const h of ["Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Content-Encoding"])
    if (r.headers.has(h)) resultHeaders.set(h, r.headers.get(h)!);
  return new Response(r.body, { status: r.status, headers: resultHeaders });
}
export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url),
      origin = req.headers.get("origin") ?? "";
    try {
      if (url.pathname.startsWith("/api/shares")) {
        if (
          origin &&
          !env.ALLOWED_ORIGINS.split(",")
            .map((x) => x.trim())
            .includes(origin)
        )
          return json({ error: "origin_not_allowed" }, 403);
        return cors(await admin(req, url, env), origin, env);
      }
      if (url.pathname.startsWith("/s/")) return await share(req, url, env);
      return json({ error: "not_found" }, 404);
    } catch {
      console.error(
        JSON.stringify({
          event: "share_request_failed",
          endpoint: url.pathname.startsWith("/api/") ? "management" : "download",
        }),
      );
      return cors(json({ error: "service_error" }, 503), origin, env);
    }
  },
  async scheduled(_controller: unknown, env: Env) {
    await env.DB.prepare("DELETE FROM shares WHERE expires <= ?").bind(now()).run();
  },
};
