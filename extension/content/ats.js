// Company career pages (Greenhouse, Lever, Ashby, Workable, SmartRecruiters): fill and submit.
// If a CAPTCHA shows up or a required question can't be answered, the tab is left open, filled in, for you.
(async () => {
  const { sleep, pause, waitFor, text, visible, byText, bg, log, collectFields, answerAndFill, hasCaptcha } = window.JP;
  if (window.__jpAts) return;
  window.__jpAts = true;

  await sleep(2500);
  let ctx;
  try { ctx = await bg("getTask"); } catch (_) { return; }
  if (!ctx || !ctx.task || ctx.task.kind !== "ats") return;
  const { task } = ctx;
  const host = location.hostname;

  // Go to the actual application form first.
  if (/lever\.co$/.test(host) && !/\/apply\/?$/.test(location.pathname)) {
    location.href = location.href.split("?")[0].replace(/\/$/, "") + "/apply";
    return;
  }
  if (/ashbyhq\.com$/.test(host) && !/\/application\/?$/.test(location.pathname)) {
    location.href = location.href.split("?")[0].replace(/\/$/, "") + "/application";
    return;
  }
  if (/workable\.com$/.test(host) && !/\/apply\/?$/.test(location.pathname)) {
    const a = byText("a, button", /^Apply for this job$/i);
    if (a && a.href) { location.href = a.href; return; }
    a?.click();
    await sleep(2500);
  }
  if (/greenhouse\.io$/.test(host)) {
    const b = byText("button, a", /^Apply( for this job| now)?$/i);
    if (b && !document.querySelector("#application_form, form#application-form, form[action*='applications']")) { b.click(); await sleep(2000); }
  }

  let outcome = { outcome: "failed", note: "" };
  let keepTab = false;
  const title = text(document.querySelector("h1, .app-title, .posting-headline h2, [class*='job-title']")) || task.label;
  const company = (task.label || "").split(":")[0];
  try {
    const prep = await bg("api", { path: `/api/ext/jobs/${task.jobId}/prepare`, method: "POST" });
    if (prep.decision !== "apply") {
      await log(`Skip: ${title} — ${prep.reason}`);
      await bg("outcome", { outcome: "skipped" });
      return bg("stepDone", {});
    }
    outcome = await apply();
  } catch (e) {
    outcome = { outcome: "failed", note: e.message };
  }
  if (outcome.outcome === "needs_you") keepTab = true;
  await bg("api", { path: "/api/ext/result", method: "POST",
    body: { job_id: task.jobId, outcome: outcome.outcome, note: outcome.note, missing: outcome.missing || [] } }).catch(() => {});
  await bg("outcome", { outcome: outcome.outcome, jobId: task.jobId, title, company, url: location.href,
    missing: outcome.missing, platform: "company" });
  await log(`${outcome.outcome === "submitted" ? "✅ Applied" : outcome.outcome === "needs_you" ? "✋ Left open for you" : "⚠️ Failed"}: ${title}${outcome.missing?.length ? ` (${outcome.missing.join("; ")})` : ""}${outcome.note && outcome.outcome === "failed" ? ` — ${outcome.note}` : ""}`);
  bg("stepDone", { keepTab });

  function formRoot() {
    return document.querySelector("#application_form, form#application-form, form[action*='applications'], .application-form, form.application, [class*='ApplicationForm'], form")
      || document.body;
  }

  // Custom dropdowns (react-select on new Greenhouse boards, Ashby buttons): read their options so the server can choose.
  async function readCombos(fields) {
    for (const f of fields) {
      if (!f.el || f.el.getAttribute("role") !== "combobox") continue;
      f.el.click();
      f.el.focus();
      await sleep(400);
      const opts = [...document.querySelectorAll("[role='option']")].filter(visible).map(text).filter(Boolean);
      f.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      f.el.blur();
      await sleep(150);
      if (opts.length) { f.type = "select"; f.options = opts.slice(0, 200); f.combo = true; }
    }
  }

  async function fillCombos(fields, jobId) {
    const combos = fields.filter((f) => f.combo && !text(f.el.closest("[class*='select__control'], [class*='control']")?.querySelector("[class*='single-value'], [class*='singleValue']")));
    if (!combos.length) return [];
    const { answers } = await bg("api", { path: "/api/ext/answers", method: "POST", body: { job_id: jobId,
      fields: combos.map(({ key, label, options, required }) => ({ key, label, type: "select", options, required })) } });
    const missing = [];
    for (const f of combos) {
      const a = answers[f.key];
      if (a == null) { if (f.required) missing.push(f.label); continue; }
      f.el.click();
      f.el.focus();
      await sleep(400);
      const opt = [...document.querySelectorAll("[role='option']")].filter(visible).find((o) => text(o).toLowerCase() === String(a).toLowerCase())
        || [...document.querySelectorAll("[role='option']")].filter(visible).find((o) => text(o).toLowerCase().startsWith(String(a).toLowerCase()));
      if (opt) opt.click(); else if (f.required) missing.push(f.label);
      await sleep(300);
    }
    return missing;
  }

  async function apply() {
    await waitFor(() => formRoot().querySelector("input, textarea"), 12000);
    if (document.querySelector("input[type='password']")) return { outcome: "needs_you", missing: ["This site wants you to sign in"], note: "Login required" };
    const resume = await bg("resume", { jobId: task.jobId });

    // Resume first: Greenhouse/Lever/Ashby parse it and pre-fill some fields.
    const root = formRoot();
    const files = [...root.querySelectorAll("input[type='file']")];
    const resumeInput = files.find((f) => /resume|cv/i.test(f.name + f.id + (f.getAttribute("aria-label") || "") + text(f.closest("div, label, fieldset")))) || files[0];
    if (resumeInput) {
      await window.JP.setFile(resumeInput, resume.b64, resume.filename);
      await sleep(4000);
    }

    const fields = collectFields(formRoot()).filter((f) => f.type !== "file");
    await readCombos(fields);
    const native = fields.filter((f) => !f.combo);
    const missing = [...await answerAndFill(task.jobId, native, {}), ...await fillCombos(fields, task.jobId)];
    await pause(800, 1500);

    if (missing.length) return { outcome: "needs_you", missing, note: "Questions only you can answer — the form is filled in and left open." };
    if (hasCaptcha()) return { outcome: "needs_you", missing: ["CAPTCHA"], note: "CAPTCHA — the form is filled in and left open for you to submit." };

    const submit = formRoot().querySelector("button[type='submit'], input[type='submit'], #submit_app, [data-qa='btn-submit']")
      || byText("button", /^(Submit( application)?|Apply|Send application)$/i);
    if (!submit) return { outcome: "needs_you", missing: ["Submit button not found"], note: "Left open for you." };
    submit.click();

    const done = await waitFor(() => {
      const t = text(document.body);
      if (/thank you for applying|thanks for applying|application (has been |was )?(received|submitted)|we('ve| have) received your application|application submitted/i.test(t)) return "ok";
      if (/confirmation|thank/i.test(location.pathname)) return "ok";
      if (hasCaptcha()) return "captcha";
      return null;
    }, 20000);
    if (done === "ok") return { outcome: "submitted", note: `Submitted on ${host}` };
    if (done === "captcha") return { outcome: "needs_you", missing: ["CAPTCHA"], note: "CAPTCHA after submit — left open for you." };
    const errs = [...document.querySelectorAll("[class*='error'], [aria-invalid='true'], .field-error")].filter(visible).map(text).filter(Boolean);
    if (errs.length) return { outcome: "needs_you", missing: [...new Set(errs)].slice(0, 6), note: "The form reported errors — left open for you." };
    return { outcome: "needs_you", missing: ["Could not confirm submission — please check"], note: "No confirmation shown." };
  }
})();
