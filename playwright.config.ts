import { defineConfig } from "@playwright/test";
const baseURL = "http://127.0.0.1:" + (process.env.R2CLIENT_SMOKE_PORT || 42931);
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    baseURL,
    headless: true,
    locale: "en-US",
    colorScheme: "light",
    viewport: { width: 1280, height: 820 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: {
    command: "node scripts/serve-built.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
