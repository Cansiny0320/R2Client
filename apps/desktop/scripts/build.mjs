import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const d = fileURLToPath(new URL("..", import.meta.url));
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await Promise.all([
  build({
    absWorkingDir: d,
    entryPoints: ["src/main.ts"],
    platform: "node",
    format: "cjs",
    bundle: true,
    external: ["electron"],
    target: "node22",
    outfile: "dist/main.cjs",
  }),
  build({
    absWorkingDir: d,
    entryPoints: ["src/preload.ts"],
    platform: "node",
    format: "cjs",
    bundle: true,
    external: ["electron"],
    target: "node22",
    outfile: "dist/preload.cjs",
  }),
  cp(new URL("../../web/dist/client/", import.meta.url), new URL("../dist/ui/", import.meta.url), {
    recursive: true,
  }),
  cp(new URL("../build/icon.png", import.meta.url), new URL("../dist/icon.png", import.meta.url)),
]);
