import { defineConfig, devices } from "@playwright/test";

const port = 4181;
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/account-service",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `VITE_SUPABASE_URL=${origin}/supabase VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_account_fixture npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: origin,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "desktop-firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "desktop-webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
