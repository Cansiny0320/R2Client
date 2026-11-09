import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  root: fileURLToPath(new URL("./renderer/", import.meta.url)),
  base: "./",
  plugins: [tailwind(), react()],
  build: {
    outDir: fileURLToPath(new URL("./dist/ui/", import.meta.url)),
    emptyOutDir: true,
  },
});
