// Regenerates the README screenshots from a demo account with fictional data (never use a real account).
//   DEMO_EMAIL=demo@example.com DEMO_PASSWORD=... BASE_URL=http://localhost:8080 node e2e/readme-screenshots.mjs
import { chromium } from 'playwright'
import * as path from 'node:path'

const base = process.env.BASE_URL ?? 'http://localhost:8080'
const email = process.env.DEMO_EMAIL ?? 'demo@example.com'
const password = process.env.DEMO_PASSWORD
const out = process.env.OUT ?? path.resolve(import.meta.dirname, '../docs/screenshots')
if (!password) throw new Error('Set DEMO_PASSWORD')

const DESKTOP = [
  ['/', 'dashboard'], ['/apply', 'apply-mode'], ['job', 'job-match'], ['/resumes', 'resume-studio'],
  ['/applications', 'applications'], ['/analytics', 'analytics'], ['/agent', 'agent'], ['/integrations', 'integrations'],
]
const MOBILE = [['/', 'mobile-dashboard'], ['/apply', 'mobile-apply'], ['/jobs/recommended', 'mobile-jobs']]

async function login(page) {
  await page.goto(base + '/login')
  await page.getByLabel(/^Email/).fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
}

async function visit(page, target) {
  if (target === 'job') {
    await page.goto(base + '/jobs/recommended')
    await page.waitForLoadState('networkidle')
    await page.locator('a[href^="/jobs/"]:not([href="/jobs/recommended"]):not([href="/jobs/saved"])').first().click()
  } else {
    await page.goto(base + target)
  }
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500) // let count-up animations settle
}

const browser = await chromium.launch()
for (const [shots, viewport, scale] of [[DESKTOP, { width: 1440, height: 900 }, 1], [MOBILE, { width: 390, height: 844 }, 2]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: 'dark', reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await login(page)
  for (const [target, name] of shots) {
    await visit(page, target)
    await page.screenshot({ path: path.join(out, `${name}.png`) })
    console.log('saved', name)
  }
  await ctx.close()
}
await browser.close()
