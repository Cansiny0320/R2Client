import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [
    tailwind(),
    tanstackStart({ prerender: { enabled: true, crawlLinks: false }, pages: [{ path: "/" }] }),
    react(),
  ],
  server: { host: "127.0.0.1" },
});
