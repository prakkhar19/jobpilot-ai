// Shared helpers for every site script. Exposed as window.JP.
(() => {
  if (window.JP) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Human pace between actions: sites rate-limit fast clicking and it keeps things stable on slow pages.
  const pause = (min = 900, max = 2200) => sleep(min + Math.random() * (max - min));

  async function waitFor(fn, timeout = 12000, every = 300) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        const v = typeof fn === "string" ? document.querySelector(fn) : fn();
        if (v) return v;
      } catch (_) { /* keep waiting */ }
      await sleep(every);
    }
    return null;
  }

  const text = (el) => (el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "");
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  function byText(selector, re, root = document) {
    return [...root.querySelectorAll(selector)].find((el) => visible(el) && re.test(text(el) || el.getAttribute("aria-label") || ""));
  }

  // Ask the background worker (it talks to the JobPilot server; content scripts can't because of CORS).
  function bg(type, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res && res.error) return reject(new Error(res.error));
        resolve(res);
      });
    });
  }
  const log = (msg) => bg("log", { msg: `[${location.hostname.replace("www.", "")}] ${msg}` }).catch(() => {});

  // React/Angular-controlled inputs ignore plain .value = ..., so use the native setter and fire events.
  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
      : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function setFile(input, b64, filename, mime = "application/pdf") {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], filename, { type: mime });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function labelFor(el, root = document) {
    const clean = (s) => (s || "").replace(/\s+/g, " ").replace(/[*✱]\s*$/, "").replace(/\brequired\b/i, "").trim();
    if (el.id) {
      const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && text(l)) return clean(text(l));
    }
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ");
      if (t.trim()) return clean(t);
    }
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    const fs = el.closest("fieldset");
    if (fs && (el.type === "radio" || el.type === "checkbox")) {
      const lg = fs.querySelector("legend");
      if (lg) return clean(text(lg));
    }
    const wrap = el.closest("label");
    if (wrap && text(wrap)) return clean(text(wrap));
    let p = el.parentElement;
    for (let i = 0; p && i < 4; i++, p = p.parentElement) {
      const l = p.querySelector("label, legend, .application-label, [class*='label'], [class*='Label']");
      if (l && !l.contains(el) && text(l)) return clean(text(l));
    }
    return clean(el.placeholder || el.name || "");
  }

  // Collect the fillable fields inside `root`. Radios sharing a name become one field with options.
  function collectFields(root = document) {
    const fields = [];
    const radios = new Map();
    const els = [...root.querySelectorAll("input, textarea, select")].filter((el) => {
      const t = (el.type || "").toLowerCase();
      if (["hidden", "submit", "button", "search", "password", "image", "reset"].includes(t)) return false;
      return visible(el) || t === "file" || t === "radio" || t === "checkbox";
    });
    for (const el of els) {
      const t = (el.type || el.tagName).toLowerCase();
      const required = el.required || el.getAttribute("aria-required") === "true" ||
        /[*✱]/.test(text(el.closest("label, fieldset, .field, div")?.querySelector("label, legend") || null));
      if (t === "radio") {
        const name = el.name || labelFor(el, root);
        const fs = el.closest("fieldset") || el.closest("[role='radiogroup']") || el.parentElement?.parentElement;
        const optLabel = text(root.querySelector(`label[for="${CSS.escape(el.id || "_")}"]`)) || text(el.closest("label")) || el.value;
        if (!radios.has(name)) {
          const lg = fs?.querySelector("legend, [class*='label'], [class*='title']");
          const f = { key: `r:${name}`, label: (text(lg) || labelFor(el, root)).replace(/[*✱]\s*$/, ""), type: "radio",
            options: [], required, els: [] };
          radios.set(name, f);
          fields.push(f);
        }
        const f = radios.get(name);
        f.options.push(optLabel);
        f.els.push(el);
        f.required = f.required || required;
        continue;
      }
      const f = { key: `f:${fields.length}`, label: labelFor(el, root), type: t === "select-one" ? "select" : t,
        options: el.tagName === "SELECT" ? [...el.options].filter((o) => o.value && !/^select/i.test(o.text)).map((o) => o.text.trim()) : [],
        required, el };
      if (t === "checkbox") { f.type = "checkbox"; f.options = ["Yes", "No"]; }
      fields.push(f);
    }
    return fields;
  }

  function isEmpty(f) {
    if (f.type === "radio") return !f.els.some((e) => e.checked);
    if (f.type === "file") return !(f.el.files && f.el.files.length);
    if (f.type === "checkbox") return false;
    if (f.el.tagName === "SELECT") return !f.el.value || /^select/i.test(f.el.selectedOptions[0]?.text || "");
    return !String(f.el.value || "").trim();
  }

  function fillField(f, value) {
    if (value == null || value === "") return false;
    const v = String(value);
    if (f.type === "radio") {
      const i = f.options.findIndex((o) => o.toLowerCase() === v.toLowerCase());
      const j = i >= 0 ? i : f.options.findIndex((o) => o.toLowerCase().startsWith(v.toLowerCase()));
      if (j < 0) return false;
      f.els[j].click();
      return true;
    }
    if (f.type === "checkbox") {
      const want = /^(yes|true|1|i agree)/i.test(v);
      if (f.el.checked !== want) f.el.click();
      return true;
    }
    if (f.el.tagName === "SELECT") {
      const opt = [...f.el.options].find((o) => o.text.trim().toLowerCase() === v.toLowerCase())
        || [...f.el.options].find((o) => o.text.trim().toLowerCase().startsWith(v.toLowerCase()));
      if (!opt) return false;
      setValue(f.el, opt.value);
      return true;
    }
    setValue(f.el, v);
    return true;
  }

  // Ask the server for answers to every empty field, fill them, and report what's still missing.
  async function answerAndFill(jobId, fields, { resume } = {}) {
    const todo = fields.filter((f) => f.type !== "file" && isEmpty(f) && f.label);
    let answers = {};
    if (todo.length) {
      const res = await bg("api", { path: "/api/ext/answers", method: "POST",
        body: { job_id: jobId, fields: todo.map(({ key, label, type, options, required }) => ({ key, label: label.slice(0, 1000), type, options: options.slice(0, 200), required })) } });
      answers = res.answers || {};
    }
    const missing = [];
    for (const f of fields) {
      if (f.type === "file") {
        const isCover = /cover/i.test(f.label + (f.el.name || "") + (f.el.id || ""));
        if (!isCover && resume && isEmpty(f)) await setFile(f.el, resume.b64, resume.filename);
        continue;
      }
      if (!isEmpty(f)) continue;
      const ok = fillField(f, answers[f.key]);
      if (!ok && f.required) missing.push(f.label);
      await sleep(150);
    }
    return missing;
  }

  const CAPTCHA = ["iframe[src*='recaptcha/api2/anchor']", "iframe[src*='hcaptcha']", ".h-captcha", ".cf-turnstile",
    "iframe[src*='challenges.cloudflare.com']", "iframe[title*='recaptcha challenge']"];
  const hasCaptcha = () => CAPTCHA.some((s) => [...document.querySelectorAll(s)].some(visible));

  // Page-structure outline sent to the server log when a site's layout isn't recognised, so selectors can be fixed.
  async function debugDump(tag, root = document.body) {
    if (!root) return;
    const lines = [];
    const short = (t, n = 80) => (t || "").replace(/\s+/g, " ").trim().slice(0, n);
    lines.push(`DUMP ${tag} url=${location.pathname}${location.search.slice(0, 120)}`);
    const hs = [...root.querySelectorAll("h1, h2, h3")].filter(visible).slice(0, 8)
      .map((h) => `${h.tagName}.${short(h.className, 60)}="${short(text(h), 60)}"`);
    lines.push(`HEADINGS ${hs.join(" || ")}`);
    const btns = [...root.querySelectorAll("button, a[role='button'], [role='button']")].filter(visible).slice(0, 25)
      .map((b) => `${short(text(b), 30) || "-"}[${short(b.getAttribute("aria-label"), 40)}]{${short(b.className, 40)}}`);
    lines.push(`BUTTONS ${btns.join(" | ")}`);
    const links = [...root.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => /jobs|company|apply/.test(h))
      .slice(0, 15).map((h) => short(h, 70));
    lines.push(`LINKS ${links.join(" | ")}`);
    const classes = new Map();
    root.querySelectorAll("[class]").forEach((e) => String(e.className).split(/\s+/).forEach((c) => {
      if (/title|company|apply|job|chat|bot|success|applied|card|description|drawer|msg|question/i.test(c)) classes.set(c, (classes.get(c) || 0) + 1);
    }));
    lines.push(`CLASSES ${[...classes.keys()].slice(0, 60).join(" ")}`);
    const attrs = new Set();
    root.querySelectorAll("*").forEach((e) => { for (const a of e.attributes) if (/^data-/.test(a.name) && /job|view|test|control/i.test(a.name)) attrs.add(`${a.name}=${short(a.value, 30)}`); });
    lines.push(`DATA ${[...attrs].slice(0, 30).join(" ")}`);
    for (const l of lines) await log(l.slice(0, 480));
  }

  // "Apply on company site": click through to the employer. If it's an application system JobPilot can fill in
  // (Greenhouse, Lever, Ashby, Workable, SmartRecruiters) the job is queued to be applied to there, next; otherwise
  // it goes to "Needs you" with the employer's link. If the click navigates this tab instead, background.js takes over.
  async function viaCompanySite(button, ev, d, platform, jobUrl) {
    const job = { jobId: ev.job_id, title: d.title, company: d.company };
    await log(`Applying (${ev.score}) on the company site: ${d.title} @ ${d.company}`);
    await bg("expectExternal", { job });
    button.click();
    await sleep(2500);
    // LinkedIn sometimes asks first ("Continue to the company site" / share profile).
    const dlg = [...document.querySelectorAll("[role='dialog'], .artdeco-modal")].find(visible);
    const cont = dlg && byText("button, a", /^(continue|continue applying|continue to (the )?(company )?(site|website)|apply)$/i, dlg);
    if (cont) cont.click();
    const ext = await bg("awaitExternal", { timeoutMs: 25000 });
    const host = (() => { try { return new URL(ext.url).hostname; } catch (_) { return ""; } })();
    if (ext.supported) {
      await bg("insertSteps", { steps: [{ kind: "ats", url: ext.url, jobId: ev.job_id, label: `${d.company}: ${d.title} (${ev.score})` }] });
      await log(`→ ${host}: applying there next.`);
      return { outcome: "queued" };
    }
    const missing = [host ? `Apply on ${host} (resume is ready in JobPilot)` : "Apply on the company site (resume is ready in JobPilot)"];
    await bg("api", { path: "/api/ext/result", method: "POST", body: { job_id: ev.job_id, outcome: "needs_you", apply_url: ext.url || "",
      note: host ? `Applies on ${host}, which JobPilot can't fill in yet.` : "The company-site link didn't open.", missing } });
    await bg("outcome", { outcome: "needs_you", jobId: ev.job_id, title: d.title, company: d.company, url: ext.url || jobUrl,
      missing, platform });
    await log(`✋ Needs you: ${d.title} @ ${d.company} — ${host ? `applies on ${host}` : "company-site link didn't open"}`);
    return { outcome: "needs_you" };
  }

  window.JP = { debugDump, sleep, pause, waitFor, text, visible, byText, bg, log, setValue, setFile, labelFor, collectFields,
    isEmpty, fillField, answerAndFill, hasCaptcha, viaCompanySite };
})();
