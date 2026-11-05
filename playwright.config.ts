import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
// E2E_BASE_URL diisi untuk menguji aplikasi yang sudah online (mis. Production), tanpa server lokal.
const REMOTE = process.env.E2E_BASE_URL;
// Claude Code web punya Chromium bawaan; di laptop pakai `npx playwright install`.
const CLOUD_CHROMIUM = "/opt/pw-browsers/chromium";
const launchOptions = fs.existsSync(CLOUD_CHROMIUM) ? { executablePath: CLOUD_CHROMIUM } : {};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: { baseURL: REMOTE ?? `http://localhost:${PORT}`, trace: "retain-on-failure", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions } },
  ],
  webServer: REMOTE
    ? undefined
    : {
        command: `npm run start -- -p ${PORT}`,
        url: `http://localhost:${PORT}/login`,
        reuseExistingServer: true,
        // Izinkan server mock webhook di localhost khusus test lokal (tidak pernah aktif di Vercel).
        env: { E2E_ALLOW_PRIVATE_HOSTS: "localhost" },
        timeout: 120_000,
      },
});
