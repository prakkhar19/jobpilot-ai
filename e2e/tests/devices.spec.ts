import { expect, test, type Page } from "@playwright/test";
import * as path from "node:path";

// Full user journey on phones, tablets and desktop browsers. Safe to run against a live instance:
// each run creates a throwaway account (@example.com, fictional resume) and deletes it at the end.
//   BASE_URL=https://your-host npx playwright test devices.spec.ts --config devices.config.ts

const PASSWORD = "Device-Test-Password-1";
const RESUME = path.join(__dirname, "..", "fixtures", "sample-resume.docx");
const PAGES = ["/", "/jobs", "/jobs/recommended", "/jobs/saved", "/resumes", "/cover-letters", "/applications",
  "/interviews", "/analytics", "/agent", "/integrations", "/profile", "/settings", "/security"];

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/401|404|409|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function csrf(page: Page): Promise<string> {
  const c = (await page.context().cookies()).find((x) => x.name === "jp_csrf");
  return c?.value ?? "";
}

async function noHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `page wider than the screen on ${where}`).toBeLessThanOrEqual(1);
}

test("full journey works on this device", async ({ page, isMobile }, info) => {
  const errors = trackErrors(page);
  const email = `device-${info.project.name.replace(/\W+/g, "-").toLowerCase()}-${Date.now()}@example.com`;
  let registered = false;
  try {
    // 1. Sign up
    await page.goto("/register");
    await noHorizontalScroll(page, "/register");
    await page.getByLabel("Full name").fill("Device Tester");
    await page.getByLabel(/^Email/).fill(email);
    await page.locator('input[type="password"]').nth(0).fill(PASSWORD);
    await page.locator('input[type="password"]').nth(1).fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/onboarding/);
    registered = true;
    await page.getByRole("button", { name: "Skip setup" }).click();
    await expect(page.getByRole("heading", { name: /Welcome back|Dashboard/ }).first()).toBeVisible();

    // 2. Upload a resume through the real file input and approve the profile
    await page.goto("/profile");
    await page.getByRole("button", { name: "Upload resume" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles(RESUME);
    await dialog.getByRole("button", { name: "Upload & extract" }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: /Approve/ }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Approve/ }).first().click();
    await expect(page.getByText("Approved").first()).toBeVisible();

    // 3. Add a job (pasted posting) and generate a tailored resume
    const headers = { "X-CSRF-Token": await csrf(page) };
    const jobRes = await page.request.post("/api/jobs/import-manual", {
      headers,
      data: {
        title: "Machine Learning Engineer", company: "Example Labs", location: "Remote",
        description: "We need a Machine Learning Engineer with Python, PyTorch and SQL experience to build " +
          "and deploy models. Experience with Docker and AWS is a plus.",
      },
    });
    expect(jobRes.status(), await jobRes.text()).toBe(201);
    const job = await jobRes.json();
    const rv = await page.request.post("/api/resume-versions", { headers, data: { job_id: job.id, use_llm: false } });
    expect(rv.status(), await rv.text()).toBe(201);
    const pdf = await page.request.get(`/api/resume-versions/${(await rv.json()).id}/download/pdf`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

    // 4. The job page shows an explained match score
    await page.goto(`/jobs/${job.id}`);
    await expect(page.getByText(/Required skills/).first()).toBeVisible();
    await noHorizontalScroll(page, "job detail");

    // 5. Every page renders without errors and fits the screen
    for (const url of PAGES) {
      await page.goto(url);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
      await noHorizontalScroll(page, url);
    }

    // 6. Navigation: the phone menu on small screens, the sidebar on large ones
    await page.goto("/");
    if (isMobile || (page.viewportSize()?.width ?? 1200) < 1024) {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await page.getByRole("navigation", { name: "Main navigation" }).last().getByRole("link", { name: "Applications" }).click();
    await expect(page).toHaveURL(/\/applications/);

    // 7. Log out and back in
    await page.getByRole("button", { name: "Open user menu" }).click();
    await page.getByRole("menuitem", { name: /Sign out|Log out/ }).click();
    await expect(page).toHaveURL(/login/);
    await page.getByLabel(/^Email/).fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole("heading", { name: /Welcome back|Dashboard/ }).first()).toBeVisible();

    expect(errors).toEqual([]);
  } finally {
    // 8. Clean up: delete the throwaway account
    if (registered) {
      const res = await page.request.post("/api/auth/delete-account", {
        headers: { "X-CSRF-Token": await csrf(page) }, data: { password: PASSWORD, confirm: "DELETE" },
      });
      expect([204, 401]).toContain(res.status());
    }
  }
});
