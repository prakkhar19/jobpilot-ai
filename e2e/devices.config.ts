import { defineConfig, devices } from "@playwright/test";

// Cross-device run: phones, tablet and the three desktop browser engines.
export default defineConfig({
  testDir: "./tests",
  testMatch: /devices\.spec\.ts/,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 2,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "iPhone (Safari)", use: { ...devices["iPhone 15"] } },
    { name: "Android (Chrome)", use: { ...devices["Pixel 7"] } },
    { name: "iPad (Safari)", use: { ...devices["iPad (gen 7)"] } },
    { name: "Laptop Chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "Laptop Safari", use: { ...devices["Desktop Safari"] } },
    { name: "Laptop Firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
