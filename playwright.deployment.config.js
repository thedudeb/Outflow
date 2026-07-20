import { defineConfig, devices } from "@playwright/test";

const rawDeploymentUrl = process.env.OUTFLOW_DEPLOYMENT_URL || "https://thedudeb.github.io/Outflow/";
const deploymentUrl = new URL(rawDeploymentUrl);
if (
  deploymentUrl.protocol !== "https:"
  || deploymentUrl.username
  || deploymentUrl.password
  || deploymentUrl.search
  || deploymentUrl.hash
  || !deploymentUrl.pathname.endsWith("/")
) {
  throw new Error("OUTFLOW_DEPLOYMENT_URL must be a credential-free HTTPS directory URL.");
}

export default defineConfig({
  testDir: "./tests/deployment",
  fullyParallel: true,
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    baseURL: deploymentUrl.href,
    serviceWorkers: "allow",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  projects: [
    {
      name: "live-desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "live-mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
