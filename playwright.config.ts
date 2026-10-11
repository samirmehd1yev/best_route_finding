import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3117",
    browserName: "chromium",
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3117",
    url: "http://127.0.0.1:3117/api/stops",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
