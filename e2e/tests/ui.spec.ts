import { expect, test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// Requires a running stack with DEMO_MODE=true and a seeded demo user:
//   make seed-demo EMAIL=demo@example.com PASSWORD=Demo-Password-123
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@example.com";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Password-123";
const SHOTS = process.env.SCREENSHOT_DIR; // optional: write README screenshots here

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/401|409|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test("new user can register through the UI and reach the dashboard", async ({ page }) => {
  const errors = trackErrors(page);
  const email = `ui-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Full name").fill("UI Tester");
  await page.getByLabel(/^Email/).fill(email);
  await page.locator('input[type="password"]').nth(0).fill("Ui-Test-Password-1");
  await page.locator('input[type="password"]').nth(1).fill("Ui-Test-Password-1");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/onboarding/);
  await shot(page, "onboarding");
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page.getByRole("heading", { name: /Welcome back|Dashboard/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("seeded demo candidate: every main page renders with real data", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/login");
  await page.getByLabel(/^Email/).fill(DEMO_EMAIL);
  await page.locator('input[type="password"]').fill(DEMO_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole("heading", { name: /Welcome back|Dashboard/ }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await shot(page, "dashboard");

  const pages: [string, string][] = [
    ["/jobs", "jobs"], ["/jobs/recommended", "recommended"], ["/resumes", "resume-studio"],
    ["/cover-letters", "cover-letters"], ["/applications", "applications"], ["/interviews", "interviews"],
    ["/analytics", "analytics"], ["/agent", "agent"], ["/integrations", "integrations"], ["/profile", "profile"],
    ["/settings", "settings"], ["/security", "security"],
  ];
  for (const [url, name] of pages) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
    await shot(page, name);
  }

  // Open the first job and check the explainable breakdown is shown.
  await page.goto("/jobs?sort=score");
  await page.waitForLoadState("networkidle");
  await page.locator('main a[href^="/jobs/"]').first().click();
  await expect(page.getByText(/Required skills/).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await shot(page, "job-match");
  expect(errors).toEqual([]);
});
