import { defineConfig, devices } from "@playwright/test";

const publicBase = process.env.OUTFLOW_PWA_BASE || "/";
if (publicBase !== "/" && !/^\/[A-Za-z0-9._/-]+\/$/.test(publicBase)) {
  throw new Error("OUTFLOW_PWA_BASE must be a slash-delimited URL path.");
}
const requestedPort = Number(process.env.OUTFLOW_PWA_PORT || (publicBase === "/" ? 4174 : 4175));
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
  throw new Error("OUTFLOW_PWA_PORT must be an available user port.");
}
const previewPort = requestedPort;
const previewOrigin = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./tests/pwa",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: previewOrigin,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `OUTFLOW_PUBLIC_BASE=${JSON.stringify(publicBase)} npm run preview -- --host 127.0.0.1 --port ${previewPort}`,
    url: `${previewOrigin}${publicBase}`,
    reuseExistingServer: !process.env.CI && publicBase === "/",
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
  ],
});
