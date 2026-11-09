import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, extname } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../apps/desktop/dist/ui/", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const port = Number(process.env.R2CLIENT_SMOKE_PORT || 42931);
createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1:" + port),
      raw = decodeURIComponent(url.pathname);
    const path = resolve(root, raw === "/" ? "index.html" : "." + raw),
      rel = relative(root, path);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw Error("Not found");
    const info = await stat(path);
    if (!info.isFile()) throw Error("Not found");
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "application/octet-stream",
      "Content-Length": info.size,
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () =>
  console.log("Static build listening on http://127.0.0.1:" + port),
);
