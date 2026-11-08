import type { Detail, ObjectStore, Part, Profile } from "./model";
const enc = new TextEncoder();
const colors = [
  ["#c3d9ec", "#204163"],
  ["#e6c7b6", "#913a3a"],
  ["#d6dfcd", "#304e3b"],
  ["#f4d794", "#80532b"],
  ["#cdd0ed", "#424877"],
];
function vector(i: number) {
  const [a, b] = colors[i % colors.length]!;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 225"><rect width="360" height="225" fill="' +
    a +
    '"/><circle cx="' +
    (80 + (i % 3) * 93) +
    '" cy="80" r="38" fill="#fff" opacity=".65"/><path d="M0 224V166L93 97l72 72 65-48 130 103Z" fill="' +
    b +
    '"/><path d="M0 225v-38l126-29 112 67Z" fill="white" opacity=".18"/></svg>'
  );
}
const entries: [string, string, string][] = [
  [
    "documents/guide.txt",
    "Quick notes\n\nWelcome to the R2Client demo. You can try uploading, renaming and deleting objects in this local demo bucket.",
    "text/plain",
  ],
  [
    "documents/links.md",
    "# Links\n\n- [Cloudflare R2](https://developers.cloudflare.com/r2/)",
    "text/markdown",
  ],
  ["data/inventory.csv", "name,category\nnotebook,office\nwater bottle,travel", "text/csv"],
  ["README.md", "# Demo bucket\n\nData is stored in memory for this session.", "text/markdown"],
  ...["lake", "coast", "forest", "dunes", "mountains", "evening", "spring", "horizon"].map(
    (n, i) => [n + ".svg", vector(i), "image/svg+xml"] as [string, string, string],
  ),
];
export const demoProfile: Profile = {
  id: "demo",
  label: "demo-assets",
  bucket: "demo-assets",
  accountId: "0".repeat(32),
  jurisdiction: "default",
  publicBase: "",
  demo: true,
};
const notFound = (name = "NoSuchKey") =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
export class DemoStore implements ObjectStore {
  private rows = new Map<string, { detail: Detail; data: Uint8Array<ArrayBuffer> }>();
  private uploads = new Map<string, { data: Map<number, Uint8Array>; type: string; job: string }>();
  constructor() {
    entries.forEach(([key, value, type], i) => {
      const data = enc.encode(value),
        modified = new Date(Date.UTC(2026, 9, 25 + Math.floor(i / 3), 9, 10 * i)).toISOString();
      this.rows.set(key, {
        data,
        detail: {
          key,
          kind: "object",
          size: data.length,
          modified,
          etag: '"demo-' + i + '"',
          type,
          metadata: {},
          storageClass: "STANDARD",
        },
      });
    });
  }
  async list(prefix: string, cursor?: string, recursive = false) {
    const result = new Map<string, Detail>();
    for (const [key, { detail }] of this.rows)
      if (key.startsWith(prefix)) {
        const tail = key.slice(prefix.length),
          slash = tail.indexOf("/");
        if (!recursive && slash >= 0) {
          const k = prefix + tail.slice(0, slash + 1);
          result.set(k, {
            key: k,
            kind: "folder",
            size: 0,
            modified: detail.modified,
            metadata: {},
          });
        } else if (tail) result.set(key, detail);
      }
    const all = [...result.values()].sort((a, b) => a.key.localeCompare(b.key)),
      start = Number(cursor || 0);
    return {
      items: all.slice(start, start + 200),
      next: start + 200 < all.length ? String(start + 200) : undefined,
    };
  }
  async head(key: string) {
    const row = this.rows.get(key);
    if (!row) throw notFound();
    return structuredClone(row.detail);
  }
  async put(
    key: string,
    data: Uint8Array,
    type: string,
    replace: boolean,
    _signal?: AbortSignal,
    metadata: Record<string, string> = {},
  ) {
    if (!replace && this.rows.has(key)) throw new Error("Object exists");
    this.rows.set(key, {
      data: Uint8Array.from(data),
      detail: {
        key,
        kind: "object",
        size: data.length,
        modified: new Date().toISOString(),
        etag: '"' + crypto.randomUUID() + '"',
        type,
        metadata,
        storageClass: "STANDARD",
      },
    });
  }
  async begin(_key: string, type: string, job: string) {
    const id = crypto.randomUUID();
    this.uploads.set(id, { data: new Map(), type, job });
    return id;
  }
  async putPart(_key: string, id: string, n: number, bytes: Uint8Array) {
    const u = this.uploads.get(id);
    if (!u) throw notFound("NoSuchUpload");
    u.data.set(n, Uint8Array.from(bytes));
    return '"part-' + n + '"';
  }
  async parts(_key: string, id: string) {
    const u = this.uploads.get(id);
    if (!u) throw notFound("NoSuchUpload");
    return [...u.data].map(([number, bytes]) => ({
      number,
      etag: '"part-' + number + '"',
      bytes: bytes.length,
    }));
  }
  async finish(key: string, id: string, parts: Part[]) {
    const u = this.uploads.get(id);
    if (!u) throw notFound("NoSuchUpload");
    const chunks = parts.map((p) => u.data.get(p.number)!);
    const b = new Uint8Array(chunks.reduce((s, x) => s + x.length, 0));
    let i = 0;
    for (const x of chunks) {
      b.set(x, i);
      i += x.length;
    }
    await this.put(key, b, u.type, true, undefined, { "r2client-job": u.job });
    this.uploads.delete(id);
  }
  async abort(_key: string, id: string) {
    this.uploads.delete(id);
  }
  async read(key: string, offset = 0, etag?: string) {
    const row = this.rows.get(key);
    if (!row) throw notFound();
    if (etag && row.detail.etag !== etag) throw new Error("Object changed");
    const data = row.data.slice(offset);
    return { etag: row.detail.etag, length: data.length, bytes: new Blob([data]).stream() };
  }
  async copy(source: string, target: string, etag?: string, detail?: Detail) {
    const row = this.rows.get(source);
    if (!row) throw notFound();
    if (etag && row.detail.etag !== etag) throw new Error("Object changed");
    await this.put(
      target,
      row.data,
      detail?.type || row.detail.type || "",
      true,
      undefined,
      detail?.metadata || row.detail.metadata,
    );
    if (detail)
      Object.assign(this.rows.get(target)!.detail, {
        cacheControl: detail.cacheControl,
        disposition: detail.disposition,
      });
  }
  async remove(key: string, etag?: string) {
    if (etag && this.rows.get(key)?.detail.etag !== etag) throw new Error("Object changed");
    this.rows.delete(key);
  }
  async signed(key: string) {
    const row = this.rows.get(key);
    if (!row) throw notFound();
    return (
      "data:" +
      (row.detail.type || "application/octet-stream") +
      ";base64," +
      btoa(Array.from(row.data, (b) => String.fromCharCode(b)).join(""))
    );
  }
}
