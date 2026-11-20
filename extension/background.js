// JobPilot Auto-Apply — background worker.
// Runs the loop: build a list of steps (search pages per platform, company-board jobs, LinkedIn outreach),
// open each one in a worker tab, and let that site's content script do the work and report back.
// State lives in chrome.storage so it survives the service worker being suspended.

const DEFAULTS = {
  server: "http://localhost:8080",
  token: "",
  settings: {
    dailyCap: 40,
    platforms: { linkedin: true, naukri: true, instahyre: true, company: true },
    outreach: true,
    outreachCap: 15,
    perCompany: 2,
    pagesPerSearch: 2,
    cycleMinutes: 60,
  },
  running: false,
  steps: [],
  stepIndex: 0,
  stepStartedAt: 0,
  workerTabId: null,
  stats: { date: "", applied: 0, skipped: 0, needsYou: 0, outreach: 0 },
  needsYou: [],
  outreachQueue: [],
  log: [],
};

const STEP_TIMEOUT_MIN = { "linkedin-search": 3, "linkedin-job": 5, "naukri-search": 3, "naukri-job": 4, "instahyre": 20, ats: 12,
  "linkedin-outreach": 6 };

let external = null; // { opener, tab, url, done, at } while following an "Apply on company site" click

// Job boards often open the employer's site with window.open(..., "noopener"), so the new tab has no opener:
// take any tab created within a few seconds of the click.
chrome.tabs.onCreated.addListener((tab) => {
  if (!external || external.done || external.tab != null) return;
  if (tab.openerTabId === external.opener || Date.now() - external.at < 15000) external.tab = tab.id;
});
let settleTimer = null;
// Employer pages: load the generic form filler (content/ats.js) into every frame once the page has loaded. Count page
// loads per step so a site that keeps redirecting can't trap the loop.
const MAX_ATS_PAGES = 14;
let frameClaim = { key: "", frameId: null };
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  const s = await state();
  if (!s.running || tabId !== s.workerTabId) return;
  const step = s.steps[s.stepIndex];
  if (!step || step.kind !== "ats") return;
  const steps = [...s.steps];
  steps[s.stepIndex] = { ...step, hops: (step.hops || 0) + 1 };
  await set({ steps });
  if (steps[s.stepIndex].hops > MAX_ATS_PAGES) {
    await log(`⚠️ ${step.label}: too many page changes on ${new URL((await chrome.tabs.get(tabId)).url).hostname} — giving up on this one.`);
    if (step.jobId) {
      await api("/api/ext/result", { method: "POST", body: { job_id: step.jobId, outcome: "failed",
        note: "The careers site kept redirecting." } }).catch(() => {});
    }
    return advance();
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content/common.js", "content/ats.js"] });
  } catch (e) { await log(`Could not open the form on this page: ${e.message}`); }
});

const JOB_BOARDS = /^https:\/\/([a-z0-9-]+\.)*(linkedin\.com|naukri\.com|ambitionbox\.com|iimjobs\.com|naukimg\.com)\//i;
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (external && !external.done && info.url && (tabId === external.opener || tabId === external.tab)) {
    log(`  company-site link → ${tabId === external.opener ? "same tab" : "new tab"}: ${info.url.split("?")[0].slice(0, 140)}`);
  }
  // Same-tab case: the job page itself navigated to the employer, so its content script is gone. Take over here.
  if (external && !external.done && Date.now() - external.at < 90000 && external.tab == null && tabId === external.opener && info.url
      && /^https?:/.test(info.url) && !JOB_BOARDS.test(info.url)) {
    const ex = external;
    external = null;
    const s = await state();
    const job = ex.job || {};
    if (job.jobId) {
      const steps = [...s.steps];
      steps[s.stepIndex] = { kind: "ats", url: info.url, jobId: job.jobId, label: `${job.company}: ${job.title}` };
      await set({ steps, stepStartedAt: Date.now() }); // ats.js on the employer page picks this up
      await log(`Company site: ${new URL(info.url).hostname} — applying there.`);
    }
    return;
  }
  if (!external || external.done || tabId !== external.tab) return;
  const url = info.url || tab.url || tab.pendingUrl || "";
  if (/^https?:/.test(url)) external.url = url;
  if (info.status === "complete") {
    clearTimeout(settleTimer); // redirects (tracking links, career-site hops) keep resetting this
    settleTimer = setTimeout(async () => {
      if (!external) return;
      external.done = true;
      if (external.awaiting || !external.job?.jobId || !/^https?:/.test(external.url) || JOB_BOARDS.test(external.url)) return;
      const ex = external;
      external = null;
      chrome.tabs.remove(ex.tab).catch(() => {});
      const s = await state();
      const steps = [...s.steps];
      steps[s.stepIndex] = { kind: "ats", url: ex.url, jobId: ex.job.jobId, label: `${ex.job.company}: ${ex.job.title}` };
      await set({ steps, stepStartedAt: Date.now() });
      await log(`Company site: ${new URL(ex.url).hostname} — applying there.`);
      await ensureWorkerTab(ex.url);
    }, 3000);
  }
});

const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);

async function state() {
  const s = await get(null);
  const merged = { ...DEFAULTS, ...s, settings: { ...DEFAULTS.settings, ...(s.settings || {}) } };
  merged.settings.platforms = { ...DEFAULTS.settings.platforms, ...((s.settings || {}).platforms || {}) };
  const today = new Date().toLocaleDateString('en-CA'); // local date (YYYY-MM-DD), not UTC
  if (merged.stats.date !== today) merged.stats = { date: today, applied: 0, skipped: 0, needsYou: 0, outreach: 0 };
  return merged;
}

let pendingLog = [];
let logTimer = null;
async function log(msg) {
  const { log: l = [] } = await get("log");
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  l.unshift(line);
  await set({ log: l.slice(0, 300) });
  pendingLog.push(line);
  if (!logTimer) logTimer = setTimeout(flushLog, 3000);
}
async function flushLog() {
  logTimer = null;
  const lines = pendingLog.splice(0, 50);
  if (!lines.length) return;
  try { await api("/api/ext/log", { method: "POST", body: { lines } }); } catch (_) { /* best effort */ }
}

// ------------------------------------------------------------------------------------------- server API

async function api(path, { method = "GET", body } = {}) {
  const s = await state();
  if (!s.token) throw new Error("Not logged in to JobPilot (open the extension popup).");
  const res = await fetch(s.server.replace(/\/$/, "") + path, {
    method,
    headers: { Authorization: `Bearer ${s.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    await set({ token: "", running: false });
    throw new Error("JobPilot session expired — log in again from the popup.");
  }
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `JobPilot returned HTTP ${res.status}`);
  return data;
}

async function resumeFor(jobId) {
  const s = await state();
  const res = await fetch(`${s.server.replace(/\/$/, "")}/api/ext/jobs/${jobId}/resume.pdf`,
    { headers: { Authorization: `Bearer ${s.token}` } });
  if (!res.ok) throw new Error(`Could not download the tailored resume (HTTP ${res.status}).`);
  const disp = res.headers.get("content-disposition") || "";
  const filename = (disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i) || [])[1] || "Resume.pdf";
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), filename: decodeURIComponent(filename) };
}

// ---------------------------------------------------------------------------------------------- steps

const enc = encodeURIComponent;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function searchTargets(cfg) {
  const roles = (cfg.target_roles || []).filter(Boolean).slice(0, 4);
  const locs = (cfg.locations || []).filter(Boolean).slice(0, 3);
  const country = (cfg.countries || [])[0] || "India";
  const wantRemote = !cfg.workplace_types?.length || cfg.workplace_types.includes("remote");
  const out = [];
  for (const role of roles) {
    for (const loc of locs) out.push({ role, location: loc, remote: false });
    if (wantRemote || !locs.length) out.push({ role, location: country, remote: true });
  }
  return out;
}

async function buildSteps() {
  const s = await state();
  const cfg = await api("/api/ext/config");
  s.stats.applied = Math.max(s.stats.applied, cfg.applied_today || 0);
  await set({ stats: s.stats, lastConfig: cfg });
  const p = s.settings.platforms;
  const steps = [];
  // Jobs JobPilot already found and scored (company boards + LinkedIn/Naukri alert emails) go first.
  if (p.company) {
    try {
      const q = await api(`/api/ext/queue?limit=${Math.max(5, s.settings.dailyCap)}`);
      const allowed = { ats: true, "linkedin-job": p.linkedin, "naukri-job": p.naukri };
      for (const j of q) {
        const kind = j.kind || "ats";
        if (!allowed[kind]) continue;
        steps.push({ kind, url: j.url, jobId: j.job_id, label: `${j.company}: ${j.title} (${j.score})` });
      }
      await log(`Already-matched jobs to apply to first: ${steps.length}.`);
    } catch (e) { await log(`Matched-jobs queue: ${e.message}`); }
  }
  const targets = searchTargets(cfg);
  // Experience filters: LinkedIn levels 1 internship, 2 entry, 3 associate, 4 mid-senior; Naukri takes your years.
  const years = typeof cfg.years_experience === "number" ? cfg.years_experience : null;
  const levels = years == null ? "" : years < 2 ? "1,2,3" : years < 5 ? "2,3,4" : "";
  if (!targets.length) await log("No target roles set — add them in JobPilot → Agent settings (or a profile headline).");
  for (const t of targets) {
    if (p.linkedin) {
      for (let page = 0; page < s.settings.pagesPerSearch; page++) {
        // f_TPR = past 24h, f_WT=2 remote. Not limited to Easy Apply: company-site jobs are followed to the employer.
        let url = `https://www.linkedin.com/jobs/search/?keywords=${enc(t.role)}&location=${enc(t.location)}&f_TPR=r86400&sortBy=DD&start=${page * 25}`;
        if (levels) url += `&f_E=${enc(levels)}`;
        if (t.remote) url += "&f_WT=2";
        steps.push({ kind: "linkedin-search", url, label: `LinkedIn: ${t.role} · ${t.remote ? "Remote" : t.location}` });
      }
    }
    if (p.naukri) {
      let url = `https://www.naukri.com/${slug(t.role)}-jobs${t.remote ? "" : `-in-${slug(t.location)}`}?jobAge=3`;
      if (years != null) url += `&experience=${Math.max(0, Math.round(years))}`; // jobs whose range includes your years
      if (t.remote) url += "&wfhType=2";
      steps.push({ kind: "naukri-search", url, label: `Naukri: ${t.role} · ${t.remote ? "Remote" : t.location}` });
    }
  }
  if (p.instahyre) steps.push({ kind: "instahyre", url: "https://www.instahyre.com/candidate/opportunities/?matching=true", label: "Instahyre matches" });
  if (s.settings.outreach) {
    for (const job of s.outreachQueue.slice(0, 10)) {
      steps.push({ kind: "linkedin-outreach", job, label: `Outreach: ${job.company}`,
        url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${job.company} recruiter`)}&origin=GLOBAL_SEARCH_HEADER` });
    }
  }
  return steps;
}

async function ensureWorkerTab(url) {
  const s = await state();
  if (s.workerTabId != null) {
    try {
      await chrome.tabs.update(s.workerTabId, { url });
      return s.workerTabId;
    } catch (_) { /* tab was closed */ }
  }
  const tab = await chrome.tabs.create({ url, active: false });
  await set({ workerTabId: tab.id });
  return tab.id;
}

async function runStep() {
  const s = await state();
  if (!s.running) return;
  if (s.stats.applied >= s.settings.dailyCap) {
    await log(`Daily cap of ${s.settings.dailyCap} applications reached. Resuming tomorrow.`);
    await set({ steps: [], stepIndex: 0 });
    chrome.alarms.create("cycle", { when: nextMidnight() });
    return;
  }
  if (s.stepIndex >= s.steps.length) {
    await log(`Cycle finished. Next one in ${s.settings.cycleMinutes} min.`);
    await set({ steps: [], stepIndex: 0 });
    chrome.alarms.create("cycle", { delayInMinutes: s.settings.cycleMinutes });
    return;
  }
  const step = s.steps[s.stepIndex];
  if (step.kind === "linkedin-outreach" && s.stats.outreach >= s.settings.outreachCap) return advance();
  await log(`▶ ${step.label}`);
  await set({ stepStartedAt: Date.now() });
  await ensureWorkerTab(step.url);
}

async function advance({ keepTab = false } = {}) {
  external = null;
  const s = await state();
  const patch = { stepIndex: s.stepIndex + 1 };
  if (keepTab) patch.workerTabId = null; // leave this tab for the user; continue in a fresh one
  await set(patch);
  setTimeout(runStep, 1500 + Math.random() * 2500);
}

let cycleStartedAt = 0;
async function startCycle() {
  if (Date.now() - cycleStartedAt < 60000) return; // one cycle start at a time
  cycleStartedAt = Date.now();
  try {
    const steps = await buildSteps();
    await set({ steps, stepIndex: 0 });
    await log(`New cycle: ${steps.length} steps.`);
    runStep();
  } catch (e) {
    await log(`Could not start: ${e.message}`);
    chrome.alarms.create("cycle", { delayInMinutes: 10 });
  }
}

function nextMidnight() {
  const d = new Date();
  d.setHours(24, 5, 0, 0);
  return d.getTime();
}

// ------------------------------------------------------------------------------------------- messages

async function handle(msg, sender) {
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case "api": return api(msg.path, { method: msg.method, body: msg.body });
    case "resume": return resumeFor(msg.jobId);
    case "log": await log(msg.msg); return {};

    // A content script asks whether it should work on its tab. Only the worker tab gets a task,
    // so normal browsing on LinkedIn/Naukri is never touched.
    case "getTask": {
      const s = await state();
      if (!s.running || tabId == null || tabId !== s.workerTabId) return { task: null };
      if (external && !external.done && external.opener === tabId && Date.now() - external.at < 90000) {
        await log(`…following the company-site link (${(sender.url || "").split("?")[0].slice(0, 120)})`);
        return { task: null }; // an in-between page (e.g. a job-board redirect): wait for the employer's page
      }
      const step = s.steps[s.stepIndex];
      if (!step) return { task: null };
      return { task: step, settings: s.settings, config: s.lastConfig, remaining: s.settings.dailyCap - s.stats.applied,
        outreachLeft: s.settings.outreachCap - s.stats.outreach };
    }

    // One job finished on the current page (the content script may handle many per page).
    case "outcome": {
      const s = await state();
      const o = msg.outcome;
      if (o === "submitted") s.stats.applied += 1;
      else if (o === "needs_you") s.stats.needsYou += 1;
      else if (o === "outreach") s.stats.outreach += 1;
      else s.stats.skipped += 1;
      const patch = { stats: s.stats };
      if (o === "submitted" && msg.jobId) patch.needsYou = s.needsYou.filter((n) => n.jobId !== msg.jobId);
      if (o === "needs_you") {
        patch.needsYou = [{ jobId: msg.jobId, title: msg.title, company: msg.company, url: msg.url,
          missing: msg.missing || [], at: Date.now() }, ...s.needsYou.filter((n) => n.jobId !== msg.jobId)].slice(0, 200);
      }
      if (o === "submitted" && msg.platform !== "outreach" && s.settings.outreach && msg.company) {
        patch.outreachQueue = [...s.outreachQueue.filter((j) => j.company !== msg.company),
          { jobId: msg.jobId, company: msg.company, title: msg.title }].slice(-50);
      }
      await set(patch);
      if (o === "needs_you") {
        chrome.notifications.create({ type: "basic", iconUrl: "icon.png", title: "JobPilot needs you",
          message: `${msg.title} at ${msg.company}: ${(msg.missing || []).slice(0, 2).join(", ") || "finish this one by hand"}` });
      }
      return { stop: !s.running || s.stats.applied >= s.settings.dailyCap,
        remaining: s.settings.dailyCap - s.stats.applied, outreachLeft: s.settings.outreachCap - s.stats.outreach };
    }

    // "Apply on company site": the content script announces the click, we catch the tab it opens (or the worker tab
    // leaving the job board), wait for redirects to settle, close the extra tab and report the employer's URL.
    case "expectExternal": {
      external = { opener: tabId, tab: null, url: "", done: false, at: Date.now(), job: msg.job || null };
      return {};
    }
    case "externalHop": {
      const s = await state();
      const active = !!(external && !external.done && external.opener === tabId && tabId === s.workerTabId);
      return { active, job: active ? external.job : null };
    }
    // Before clicking "Apply on company site": wrap the page's window.open (in the page itself, not our sandbox) so the
    // employer URL is captured even though Chrome blocks the pop-up (our click isn't a real user gesture).
    case "hookOpen": {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, world: "MAIN", func: () => {
        if (window.__jpOpenHooked) return;
        window.__jpOpenHooked = true;
        const record = (u) => {
          try {
            const url = new URL(String(u), location.href).href;
            if (!/^https?:/.test(url)) return;
            sessionStorage.setItem("jpOpened", url);
            window.postMessage({ jpOpened: url }, "*");
          } catch (_) { /* ignore */ }
        };
        const fakeWindow = () => {
          const loc = { assign: record, replace: record };
          Object.defineProperty(loc, "href", { set: record, get: () => "about:blank" });
          const w = { closed: false, opener: null, focus() {}, blur() {}, close() { this.closed = true; }, document: { write() {}, close() {} } };
          Object.defineProperty(w, "location", { set: record, get: () => loc });
          return w;
        };
        window.open = function (u) { if (u) record(u); return fakeWindow(); };
        document.addEventListener("click", (e) => {
          const a = e.target.closest && e.target.closest("a[target='_blank'][href]");
          if (a && !/naukri\.com|linkedin\.com/.test(new URL(a.href, location.href).hostname)) record(a.href);
        }, true);
      } });
      return {};
    }
    case "externalUrl": {
      if (external && !external.done && !JOB_BOARDS.test(msg.url || "")) { external.url = msg.url; external.viaOpen = true; }
      return {};
    }

    // The job board's own page says it sent you to the employer (Naukri "showAcp"): take the employer tab it opened,
    // close it, and continue there in the worker tab with ats.js.
    case "finishExternal": {
      const good = (u) => /^https?:/.test(u || "") && !JOB_BOARDS.test(u);
      // Naukri's redirect endpoint (records the apply, then forwards to the employer): open it in the worker tab and let
      // the same-tab capture below take the employer page it lands on.
      const hop = [msg.url, external?.url].find((u) => /naukri\.com\/cloudgateway-apply\/|naukri\.com\/.*(redirect|companyapply)/i.test(u || ""));
      if (hop && external) {
        external = { ...external, tab: null, url: "", done: false, at: Date.now(), awaiting: false };
        await log("Following Naukri's redirect to the company site…");
        chrome.tabs.update(tabId, { url: hop });
        return { url: hop, following: true };
      }
      if (external && good(msg.url) && !good(external.url)) { external.url = msg.url; external.viaOpen = true; }
      const until = Date.now() + 15000;
      while (Date.now() < until && !(external && good(external.url) && (external.viaOpen || external.tab != null))) {
        await new Promise((r) => setTimeout(r, 500));
      }
      const ex = external;
      external = null;
      if (!ex || !good(ex.url)) return { url: "" };
      let url = ex.url;
      if (ex.tab != null) {
        await new Promise((r) => setTimeout(r, 2500)); // let tracking redirects finish
        const t = await chrome.tabs.get(ex.tab).catch(() => null);
        if (t && good(t.url)) url = t.url;
        chrome.tabs.remove(ex.tab).catch(() => {});
      }
      const s = await state();
      const steps = [...s.steps];
      steps[s.stepIndex] = { kind: "ats", url, jobId: ex.job?.jobId, label: `${ex.job?.company}: ${ex.job?.title}` };
      await set({ steps, stepStartedAt: Date.now() });
      await log(`Company site: ${new URL(url).hostname} — applying there.`);
      chrome.tabs.update(tabId, { url });
      return { url };
    }
    case "awaitExternal": {
      if (external) external.awaiting = true;
      const until = Date.now() + (msg.timeoutMs || 20000);
      while (Date.now() < until && !(external && (external.done || (external.viaOpen && external.url)))) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (external?.viaOpen && external.tab == null) await new Promise((r) => setTimeout(r, 1500));
      const got = external;
      external = null;
      if (got?.tab != null) chrome.tabs.remove(got.tab).catch(() => {});
      const url = got?.url || "";
      return { url, supported: /^https?:/.test(url) && !JOB_BOARDS.test(url) };
    }

    // Several frames may hold a form (careers sites embed the application in an iframe): one wins per page load.
    case "claimFrame": {
      const s = await state();
      const step = s.steps[s.stepIndex];
      if (tabId !== s.workerTabId || !step) return { ok: false };
      const key = `${s.stepIndex}:${step.hops || 0}`;
      if (frameClaim.key !== key) frameClaim = { key, frameId: sender.frameId ?? 0 };
      return { ok: frameClaim.frameId === (sender.frameId ?? 0) };
    }

    // Open a link (e.g. "verify your email") in a background tab, let it load, close it.
    case "openAndClose": {
      const tab = await chrome.tabs.create({ url: msg.url, active: false });
      const until = Date.now() + 30000;
      let finalUrl = msg.url;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1000));
        const t = await chrome.tabs.get(tab.id).catch(() => null);
        if (!t) break;
        finalUrl = t.url || finalUrl;
        if (t.status === "complete") { await new Promise((r) => setTimeout(r, 4000)); break; }
      }
      chrome.tabs.remove(tab.id).catch(() => {});
      return { finalUrl };
    }

    // Remember a click on Apply so the next page (after a redirect) can confirm it.
    case "setPending": await set({ pendingApply: msg.pending ? { ...msg.pending, at: Date.now() } : null }); return {};
    case "getPending": {
      const { pendingApply } = await get("pendingApply");
      return { pending: pendingApply && Date.now() - pendingApply.at < 5 * 60000 ? pendingApply : null };
    }

    // A search page found job pages to visit one by one (Naukri): queue them right after the current step.
    case "insertSteps": {
      const s = await state();
      if (tabId !== s.workerTabId) return {};
      const steps = [...s.steps];
      const known = new Set(steps.map((x) => x.url));
      steps.splice(s.stepIndex + 1, 0, ...(msg.steps || []).filter((x) => !known.has(x.url)).slice(0, 60));
      await set({ steps });
      return { count: steps.length };
    }

    // The page is done (all jobs on it handled, or it failed).
    case "stepDone": {
      const s = await state();
      if (tabId !== s.workerTabId) return {};
      if (msg.outreachDone) {
        await set({ outreachQueue: s.outreachQueue.filter((j) => j.jobId !== msg.outreachDone) });
      }
      if (msg.note) await log(msg.note);
      await advance({ keepTab: !!msg.keepTab });
      return {};
    }

    // ---- popup
    case "login": {
      const server = (msg.server || DEFAULTS.server).replace(/\/$/, "");
      const res = await fetch(`${server}/api/ext/login`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: msg.email, password: msg.password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Login failed (HTTP ${res.status})`);
      await set({ server, token: data.token, account: data.email });
      return { ok: true, name: data.name };
    }
    case "logout": await set({ token: "", running: false }); return {};
    case "start": {
      await set({ running: true });
      await log("Started.");
      startCycle();
      return {};
    }
    case "stop": {
      await set({ running: false, steps: [], stepIndex: 0 });
      chrome.alarms.clear("cycle");
      await log("Stopped.");
      return {};
    }
    case "saveSettings": await set({ settings: msg.settings }); return {};
    case "state": return state();
    case "answerNeedsYou": {
      for (const [question, answer] of Object.entries(msg.answers || {})) {
        if (answer.trim()) await api("/api/ext/answer-bank", { method: "POST", body: { question, answer } });
      }
      const s = await state();
      await set({ needsYou: s.needsYou.filter((n) => n.jobId !== msg.jobId) });
      return {};
    }
    case "dismissNeedsYou": {
      const s = await state();
      await set({ needsYou: s.needsYou.filter((n) => n.jobId !== msg.jobId) });
      return {};
    }
    default: return { error: `unknown message ${msg.type}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(reply, (e) => reply({ error: e.message || String(e) }));
  return true;
});

// Pre-connected install: config.local.json (written by scripts/connect-extension.sh, git-ignored) holds the server
// URL and a session token, so no login is needed; with "autostart" the loop starts as soon as Chrome loads it.
async function bootstrap() {
  const s = await state();
  if (s.token) {
    if (s.running) {
      await log("Extension (re)loaded — starting a fresh cycle.");
      startCycle();
    }
    return;
  }
  try {
    const res = await fetch(chrome.runtime.getURL("config.local.json"));
    if (!res.ok) return;
    const c = await res.json();
    if (!c.token) return;
    await set({ server: c.server || DEFAULTS.server, token: c.token, account: c.account || "" });
    await log(`Connected to JobPilot as ${c.account || "you"}.`);
    if (c.autostart) {
      await set({ running: true });
      await log("Auto-started.");
      startCycle();
    }
  } catch (_) { /* no pre-connect file */ }
}
chrome.runtime.onInstalled.addListener(bootstrap);
chrome.runtime.onStartup.addListener(bootstrap);

// Watchdog: if a page hangs (site changed, network stall), move on.
chrome.alarms.create("watchdog", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (a) => {
  const s = await state();
  if (!s.running) return;
  if (a.name === "cycle") return startCycle();
  if (a.name === "watchdog" && s.steps.length && s.stepIndex < s.steps.length) {
    const step = s.steps[s.stepIndex];
    const limit = (STEP_TIMEOUT_MIN[step.kind] || 10) * 60000;
    if (Date.now() - s.stepStartedAt > limit) {
      await log(`Timed out on ${step.label}; moving on.`);
      advance();
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await state();
  if (tabId === s.workerTabId) await set({ workerTabId: null });
});

// Self-update for the unpacked install: when version.txt on disk changes (code was updated), reload the extension.
// The version that was loaded is kept in storage.session (cleared on every reload), not in a variable: Chrome stops
// and restarts this service worker whenever it's idle, and a variable would pick up the new version unseen.
async function checkVersion() {
  try {
    const v = (await (await fetch(chrome.runtime.getURL("version.txt"), { cache: "no-store" })).text()).trim();
    const { loadedVersion } = await chrome.storage.session.get("loadedVersion");
    if (!loadedVersion) await chrome.storage.session.set({ loadedVersion: v });
    else if (v !== loadedVersion) {
      await log("Code updated — reloading extension.");
      await flushLog().catch(() => {});
      chrome.runtime.reload();
    }
  } catch (_) { /* ignore */ }
}
checkVersion();
chrome.alarms.create("version", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "version") checkVersion(); });
