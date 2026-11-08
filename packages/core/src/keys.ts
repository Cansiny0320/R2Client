import type { Item, Mutation, Profile } from "./model";

export const MiB = 1024 * 1024;
export const GiB = 1024 * MiB;
export const MAX_OBJECT = 5 * 1024 * GiB;
export const UPLOAD_PART_MIN = 5 * MiB;
export function partSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_OBJECT)
    throw new Error("File size is outside R2 limits");
  return Math.max(32 * MiB, Math.ceil(size / 10_000 / MiB) * MiB);
}
export function profileEndpoint(profile: Pick<Profile, "accountId" | "jurisdiction">) {
  if (!/^[a-f0-9]{32}$/i.test(profile.accountId))
    throw new Error("R2 Account ID must be 32 hexadecimal characters");
  if (!["default", "eu", "fedramp"].includes(profile.jurisdiction))
    throw new Error("Unsupported R2 jurisdiction");
  const suffix = profile.jurisdiction === "default" ? "" : "." + profile.jurisdiction;
  return "https://" + profile.accountId.toLowerCase() + suffix + ".r2.cloudflarestorage.com";
}
export function checkProfile(p: Profile) {
  profileEndpoint(p);
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(p.bucket))
    throw new Error("Invalid R2 bucket name");
  if (!p.label.trim() || p.label.length > 128) throw new Error("A display name is required");
  if (p.publicBase) {
    const url = new URL(p.publicBase);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      throw new Error("Public URL must use HTTPS");
  }
}
export const nameOf = (key: string) => key.replace(/\/$/, "").split("/").at(-1) || key;
export const parentOf = (key: string) =>
  key.slice(0, key.lastIndexOf("/", key.endsWith("/") ? key.length - 2 : key.length - 1) + 1);
// Object keys may not contain control characters.
/* oxlint-disable eslint/no-control-regex */
export function checkKey(key: string) {
  if (!key || /[\u0000-\u001f\u007f]/.test(key) || new TextEncoder().encode(key).length > 1024) {
    throw new Error("Invalid R2 object key");
  }
  // WHATWG URLs normalize dot-only path segments even when percent encoded.
  if (key.split("/").some((part) => part === "." || part === ".."))
    throw new Error("Dot-only object path segments are not supported");
  return key;
}
export function joined(prefix: string, name: string) {
  return checkKey(prefix + name.replace(/\\/g, "/").replace(/^\/+/, ""));
}
export const encodeSegment = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
export const encodeKey = (s: string) => checkKey(s).split("/").map(encodeSegment).join("/");
export function safeRelative(key: string) {
  const segments = key.split("/");
  if (
    segments.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        /[<>:"\\|?*\x00-\x1f]|[ .]$/.test(p) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9鹿虏鲁]|LPT[1-9鹿虏鲁])(?:\.|$)/i.test(p),
    )
  ) {
    throw new Error("This object key cannot safely be written as a local path: " + key);
  }
  return segments;
}
/* oxlint-enable eslint/no-control-regex */
export function publicLink(base: string, key: string) {
  if (!base) throw new Error("Set a public URL for this bucket first");
  return base.replace(/\/+$/, "") + "/" + encodeKey(key);
}
export function formatLink(
  url: string,
  name: string,
  format: "url" | "markdown" | "html" | "bbcode",
) {
  if (format === "url") return url;
  const img = /\.(?:jpg|jpeg|png|gif|webp|avif|svg)$/i.test(name);
  if (format === "markdown")
    return (
      (img ? "!" : "") +
      "[" +
      name.replace(/[\[\]\\]/g, "\\$&") +
      "](<" +
      url.replace(/[<>]/g, encodeSegment) +
      ">)"
    );
  if (format === "bbcode")
    return (
      "[" +
      (img ? "img" : "url") +
      "]" +
      url.replaceAll("[", "%5B").replaceAll("]", "%5D") +
      "[/" +
      (img ? "img" : "url") +
      "]"
    );
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  return img
    ? '<img src="' + escape(url) + '" alt="' + escape(name) + '">'
    : '<a href="' + escape(url) + '">' + escape(name) + "</a>";
}
export type RenameRule = {
  mode: "prefix" | "suffix" | "number" | "replace" | "regex" | "name";
  text: string;
  replacement: string;
};
export function renamePlan(items: Item[], rule: RenameRule): Mutation[] {
  if (rule.mode === "name" && items.length !== 1)
    throw new Error("Choose a single object to set its name");
  const pattern = rule.mode === "regex" ? new RegExp(rule.text, "gu") : undefined;
  const sources = new Set(items.map((i) => i.key)),
    used = new Set<string>();
  return items.flatMap((item, i) => {
    const n = nameOf(item.key),
      dot = item.kind === "folder" ? -1 : n.lastIndexOf("."),
      stem = dot > 0 ? n.slice(0, dot) : n,
      ext = dot > 0 ? n.slice(dot) : "";
    const targetName =
      rule.mode === "prefix"
        ? rule.text + n
        : rule.mode === "suffix"
          ? stem + rule.text + ext
          : rule.mode === "number"
            ? rule.text +
              String(i + 1).padStart(Math.max(2, String(items.length).length), "0") +
              ext
            : rule.mode === "name"
              ? rule.text
              : pattern
                ? n.replace(pattern, rule.replacement)
                : n.replaceAll(rule.text, rule.replacement);
    if (!targetName || /[/\\]/.test(targetName))
      throw new Error("A name cannot contain path separators");
    const target = joined(parentOf(item.key), targetName + (item.kind === "folder" ? "/" : ""));
    if (target === item.key) return [];
    if (sources.has(target) || used.has(target)) throw new Error("Conflicting rename: " + target);
    used.add(target);
    return [{ kind: "move", key: item.key, target, expectedEtag: item.etag }];
  });
}
export function byteLabel(n: number): string {
  if (n < 1024) return n + " B";
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return (
    (n / 1024 ** i).toLocaleString(undefined, { maximumFractionDigits: 1 }) +
    " " +
    ["B", "KB", "MB", "GB", "TB"][i]
  );
}
export function errorText(e: unknown): string {
  const value = e instanceof Error ? e.message : String(e);
  return value.replace(/https?:\/\/[^\s]*[?][^\s]+/gi, "[URL]").slice(0, 420);
}
export function notFound(e: unknown) {
  const v = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return v?.$metadata?.httpStatusCode === 404 || ["NotFound", "NoSuchKey"].includes(v?.name ?? "");
}
export function objectCategory(key: string) {
  const ext = key.toLowerCase().split(".").at(-1) ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "tiff", "ico"].includes(ext))
    return "image";
  if (["mp4", "webm", "mov", "mkv", "avi", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "flac", "ogg", "m4a", "opus"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (["txt", "md", "csv", "json", "xml", "yaml", "yml", "log"].includes(ext)) return "text";
  return "file";
}
