import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    headless: true,
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command: "npx http-server ./public -p 4173 -s",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
