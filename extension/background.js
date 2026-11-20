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

const STEP_TIMEOUT_MIN = { "linkedin-search": 25, "naukri-search": 3, "naukri-job": 4, "instahyre": 20, ats: 5,
  "linkedin-outreach": 6 };

const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);

async function state() {
  const s = await get(null);
  const merged = { ...DEFAULTS, ...s, settings: { ...DEFAULTS.settings, ...(s.settings || {}) } };
  merged.settings.platforms = { ...DEFAULTS.settings.platforms, ...((s.settings || {}).platforms || {}) };
  const today = new Date().toISOString().slice(0, 10);
  if (merged.stats.date !== today) merged.stats = { date: today, applied: 0, skipped: 0, needsYou: 0, outreach: 0 };
  return merged;
}

async function log(msg) {
  const { log: l = [] } = await get("log");
  l.unshift(`${new Date().toLocaleTimeString()}  ${msg}`);
  await set({ log: l.slice(0, 300) });
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
  const targets = searchTargets(cfg);
  if (!targets.length) await log("No target roles set — add them in JobPilot → Agent settings (or a profile headline).");
  for (const t of targets) {
    if (p.linkedin) {
      for (let page = 0; page < s.settings.pagesPerSearch; page++) {
        // f_AL = Easy Apply only, f_TPR = past 24h, f_WT=2 remote.
        let url = `https://www.linkedin.com/jobs/search/?keywords=${enc(t.role)}&location=${enc(t.location)}&f_AL=true&f_TPR=r86400&sortBy=DD&start=${page * 25}`;
        if (t.remote) url += "&f_WT=2";
        steps.push({ kind: "linkedin-search", url, label: `LinkedIn: ${t.role} · ${t.remote ? "Remote" : t.location}` });
      }
    }
    if (p.naukri) {
      let url = `https://www.naukri.com/${slug(t.role)}-jobs${t.remote ? "" : `-in-${slug(t.location)}`}?jobAge=3`;
      if (t.remote) url += "&wfhType=2";
      steps.push({ kind: "naukri-search", url, label: `Naukri: ${t.role} · ${t.remote ? "Remote" : t.location}` });
    }
  }
  if (p.instahyre) steps.push({ kind: "instahyre", url: "https://www.instahyre.com/candidate/opportunities/?matching=true", label: "Instahyre matches" });
  if (p.company) {
    try {
      const q = await api(`/api/ext/queue?limit=${Math.max(5, s.settings.dailyCap)}`);
      for (const j of q) steps.push({ kind: "ats", url: j.url, jobId: j.job_id, label: `${j.company}: ${j.title} (${j.score})` });
    } catch (e) { await log(`Company queue: ${e.message}`); }
  }
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
  const s = await state();
  const patch = { stepIndex: s.stepIndex + 1 };
  if (keepTab) patch.workerTabId = null; // leave this tab for the user; continue in a fresh one
  await set(patch);
  setTimeout(runStep, 1500 + Math.random() * 2500);
}

async function startCycle() {
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

    // A search page found job pages to visit one by one (Naukri): queue them right after the current step.
    case "insertSteps": {
      const s = await state();
      if (tabId !== s.workerTabId) return {};
      const steps = [...s.steps];
      steps.splice(s.stepIndex + 1, 0, ...(msg.steps || []).slice(0, 60));
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
