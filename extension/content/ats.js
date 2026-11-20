// Company career pages — any employer site (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, Darwinbox,
// Zoho Recruit, Keka, Freshteam, custom careers pages…). Loaded into every frame of the worker tab by background.js.
// It works like a person would, one screen at a time: find the Apply button, create or sign in to the portal account
// (verifying the email through the connected mailbox), fill every page from the profile/answer bank, Next → Submit.
// Only a CAPTCHA or a required question that nothing in JobPilot can answer leaves the filled-in tab open for you.
(async () => {
  const { sleep, pause, waitFor, text, visible, byText, bg, log, collectFields, answerAndFill, hasCaptcha, setValue, labelFor } = window.JP;
  if (window.__jpAts) return;
  window.__jpAts = true;

  await sleep(2000);
  let ctx;
  try { ctx = await bg("getTask"); } catch (_) { return; }
  if (!ctx || !ctx.task || ctx.task.kind !== "ats") return;
  const { task } = ctx;
  const host = location.hostname.toLowerCase();
  const isTop = window === window.top;
  const BTN = "button, a, [role='button'], input[type='submit'], input[type='button']";

  const inputsHere = (root = document) => [...root.querySelectorAll("input, textarea, select")].filter((e) =>
    visible(e) && !["hidden", "submit", "button", "search", "image", "reset"].includes((e.type || "").toLowerCase()));
  // An application form, not a search box or newsletter sign-up.
  const formish = () => inputsHere().length >= 3 || [...document.querySelectorAll("input[type='file']")].length > 0;

  // Careers sites often embed the application in an iframe: the frame holding the form takes the job.
  if (!isTop) {
    await waitFor(formish, 6000);
    if (!formish()) return;
  } else if (!formish() && document.querySelector("iframe")) {
    await sleep(6000);
  }
  if (!(await bg("claimFrame")).ok) return;

  // Known shortcuts to the form.
  if (/(^|\.)lever\.co$/.test(host) && !/\/apply\/?$/.test(location.pathname)) {
    location.href = location.href.split("?")[0].replace(/\/$/, "") + "/apply";
    return;
  }
  if (/(^|\.)ashbyhq\.com$/.test(host) && !/\/application\/?$/.test(location.pathname)) {
    location.href = location.href.split("?")[0].replace(/\/$/, "") + "/application";
    return;
  }

  const DONE = /thank you for (applying|your application|your interest in)|thanks for applying|application (has been |was )?(received|submitted|sent|complete)|successfully (applied|submitted)|we('ve| have) received your application|you('ve| have) (successfully )?applied|your application is (complete|on its way)/i;
  const ALREADY = /you('ve| have) already applied|already submitted an application/i;
  const VERIFY = /verify your (e-?mail|account|address)|verification (e-?mail|link|code)|check your (e-?mail|inbox)|activate your account|confirm your e-?mail|we('ve| have) sent (you )?an? (e-?mail|code|link)/i;
  const APPLY = /^(apply( now| online| here)?|apply for (this|the) (job|position|role|opening)|apply to (this )?job|i'?m interested|start (your |my )?application|apply manually|use my last application|apply with (your )?(resume|cv))$/i;
  const SUBMIT = /^(submit( (my |your )?application)?|send( (my )?application)?|apply( now)?|finish|complete( (my )?application)?|submit & finish|confirm( and submit)?)$/i;
  const NEXT = /^(next|continue|save (and|&) continue|save (and|&) next|proceed|next step|review( application)?|go to next step)$/i;

  // ------------------------------------------------------------------------------------------ main loop

  function needs(missing, note) { return { outcome: "needs_you", missing: [].concat(missing), note: note || "Left open for you." }; }

  // A button that opens the application in a pop-up: record its URL (open-hook in the page) and go there ourselves.
  let popupUrl = "";
  window.addEventListener("message", (e) => { if (e.source === window && e.data && e.data.jpOpened) popupUrl = e.data.jpOpened; });
  await bg("hookOpen").catch(() => {});

  async function run() {
    let lastSig = "";
    let samePage = 0;
    for (let round = 0; round < 25; round++) {
      await pause(900, 1600);
      const body = text(document.body).slice(0, 8000);
      if (DONE.test(body)) return { outcome: "submitted", note: `Submitted on ${host}` };
      if (ALREADY.test(body)) return { outcome: "submitted", note: `Already applied on ${host}` };
      if (hasCaptcha()) return needs("CAPTCHA", "CAPTCHA — everything is filled in; solve it and submit.");

      const sig = location.href + "|" + body.slice(0, 1500);
      samePage = sig === lastSig ? samePage + 1 : 0;
      lastSig = sig;
      if (samePage >= 3) return needs(visibleErrors().length ? visibleErrors() : ["This page didn't move on"], "Stuck on this page — left open for you.");

      const pw = passwords();
      if (pw.length) {
        const r = await account(pw);
        if (r) return r;
        continue;
      }
      if (VERIFY.test(body) && !formish()) {
        const r = await verify();
        if (r !== "continue") return r;
        continue;
      }
      if (formish()) {
        const r = await fillAndAdvance();
        if (r) return r;
        continue;
      }
      // Job description page: get to the form.
      const apply = findButton(APPLY);
      if (apply) {
        await log(`Opening the application form on ${host}…`);
        // Many careers sites open their application system (Workday, iCIMS, SuccessFactors…) in a new tab, which
        // Chrome blocks for a scripted click: follow the link here instead.
        const a = apply.closest("a[href]");
        if (a && /^https?:/.test(a.href) && (a.target === "_blank" || new URL(a.href).hostname !== location.hostname)) {
          location.href = a.href;
          return null;
        }
        press(apply);
        const opened = await waitFor(() => popupUrl, 3500);
        if (opened) {
          await log(`→ ${new URL(opened).hostname}`);
          location.href = opened;
          return null;
        }
        continue;
      }
      if (round > 2) {
        await window.JP.debugDump("ats-no-form");
        return needs(["Couldn't find the application form"], `Nothing to fill in on ${host}.`);
      }
      await sleep(2500); // slow single-page apps
    }
    return needs(["Too many steps"], "The form kept going — left open for you.");
  }

  // ------------------------------------------------------------------------------------------ helpers

  // Workday and some React sites put a transparent overlay ("click_filter") on top of their buttons.
  function press(el) {
    const overlay = el.parentElement?.querySelector("[data-automation-id='click_filter']");
    (overlay && visible(overlay) ? overlay : el).click();
  }

  function findButton(re, root = document) {
    return byText(BTN, re, root) || [...root.querySelectorAll("input[type='submit'], input[type='button']")]
      .find((b) => visible(b) && re.test(b.value || ""));
  }

  const passwords = () => [...document.querySelectorAll("input[type='password']")].filter(visible);

  function visibleErrors() {
    return [...new Set([...document.querySelectorAll("[class*='error' i]:not(input), [role='alert'], [data-automation-id='errorMessage'], .field-error")]
      .filter(visible).map(text).filter((t) => t && t.length < 200))].slice(0, 6);
  }

  // The form with the most fields (a page can also have search boxes, newsletter sign-ups…).
  function formRoot() {
    const known = document.querySelector("#application_form, form#application-form, form[action*='applications'], .application-form, form.application, [class*='ApplicationForm'], [data-automation-id='applyFlowPage']");
    if (known) return known;
    const forms = [...document.querySelectorAll("form")].map((f) => [f, inputsHere(f).length]).sort((a, b) => b[1] - a[1]);
    const outside = inputsHere().length - (forms[0]?.[1] || 0);
    return forms.length && forms[0][1] >= outside ? forms[0][0] : document.body;
  }

  let resumeCache = null;
  async function resume() {
    resumeCache = resumeCache || await bg("resume", { jobId: task.jobId });
    return resumeCache;
  }

  async function fillAndAdvance() {
    const root = formRoot();
    const files = [...root.querySelectorAll("input[type='file']")];
    const resumeInput = files.find((f) => /resume|cv/i.test(f.name + f.id + (f.getAttribute("aria-label") || "") + (f.getAttribute("data-automation-id") || "") + text(f.closest("div, label, fieldset")))) || files[0];
    if (resumeInput && !(resumeInput.files && resumeInput.files.length)) {
      const r = await resume();
      await window.JP.setFile(resumeInput, r.b64, r.filename);
      await sleep(4000); // many sites parse the resume and pre-fill fields
    }
    const fields = collectFields(formRoot()).filter((f) => f.type !== "file");
    await readCombos(fields);
    const listboxes = await readListboxes(formRoot());
    const missing = [
      ...await answerAndFill(task.jobId, fields.filter((f) => !f.combo), {}),
      ...await fillChoices(fields.filter((f) => f.combo)),
      ...await fillChoices(listboxes),
    ];
    // Consent boxes ("I agree to the privacy policy") are required to submit.
    for (const f of fields) {
      if (f.type === "checkbox" && f.required && !f.el.checked && /agree|accept|consent|terms|privacy|policy|acknowledge|certify/i.test(f.label)) f.el.click();
    }
    await pause(700, 1300);
    if (missing.length) return needs(missing, "Questions only you can answer — the form is filled in and left open.");
    if (hasCaptcha()) return needs("CAPTCHA", "CAPTCHA — everything is filled in; solve it and submit.");

    const r = formRoot();
    const submit = findButton(SUBMIT, r) || (r !== document.body && r.querySelector("button[type='submit'], input[type='submit']"));
    const next = !submit && (findButton(NEXT, r) || findButton(NEXT) || document.querySelector("[data-automation-id='bottom-navigation-next-button'], [data-automation-id='pageFooterNextButton']"));
    const btn = submit || next || findButton(SUBMIT);
    if (!btn) return needs(["Submit button not found"], "Filled in — left open for you to submit.");
    await log(`${submit ? "Submitting" : "Next page"} on ${host}…`);
    press(btn);
    await sleep(3500);
    return null;
  }

  // Custom dropdowns: react-select (role=combobox) and Workday-style buttons (aria-haspopup=listbox).
  async function openOptions(el) {
    press(el);
    el.focus?.();
    await sleep(500);
    return [...document.querySelectorAll("[role='option']")].filter(visible);
  }
  async function closeOptions(el) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    el.blur?.();
    await sleep(150);
  }

  async function readCombos(fields) {
    for (const f of fields) {
      if (!f.el || f.el.getAttribute("role") !== "combobox") continue;
      const opts = (await openOptions(f.el)).map(text).filter(Boolean);
      await closeOptions(f.el);
      if (opts.length) { f.type = "select"; f.options = opts.slice(0, 200); f.combo = true; }
    }
  }

  async function readListboxes(root) {
    const out = [];
    const btns = [...root.querySelectorAll("button[aria-haspopup='listbox']")].filter(visible);
    for (const [i, b] of btns.entries()) {
      if (!/^(select( one)?|choose|--|please select)?$/i.test(text(b))) continue; // already chosen
      const opts = (await openOptions(b)).map(text).filter((t) => t && !/^select one$/i.test(t));
      await closeOptions(b);
      const label = labelFor(b, root);
      const required = b.getAttribute("aria-required") === "true" || /[*✱]/.test(text(b.closest("[data-automation-id^='formField'], div")?.querySelector("label") || null));
      if (opts.length && label) out.push({ key: `lb:${i}`, label, type: "select", options: opts.slice(0, 200), required, el: b, combo: true });
    }
    return out;
  }

  async function fillChoices(choices) {
    if (!choices.length) return [];
    const { answers } = await bg("api", { path: "/api/ext/answers", method: "POST", body: { job_id: task.jobId,
      fields: choices.map(({ key, label, options, required }) => ({ key, label: label.slice(0, 1000), type: "select", options, required })) } });
    const missing = [];
    for (const f of choices) {
      const a = answers[f.key];
      if (a == null) { if (f.required) missing.push(f.label); continue; }
      const opts = await openOptions(f.el);
      const want = String(a).toLowerCase();
      const opt = opts.find((o) => text(o).toLowerCase() === want) || opts.find((o) => text(o).toLowerCase().startsWith(want));
      if (opt) opt.click(); else { await closeOptions(f.el); if (f.required) missing.push(f.label); }
      await sleep(300);
    }
    return missing;
  }

  // ------------------------------------------------------------------- portal accounts (Workday & co.)

  function newPassword() {
    const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%&*?"];
    const rnd = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
    const chars = sets.map((s) => s[rnd(s.length)]);
    const all = sets.join("");
    while (chars.length < 16) chars.push(all[rnd(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    return chars.join("");
  }

  const emailInputs = () => inputsHere().filter((e) => e.type === "email"
    || /e-?mail|user ?name|login id/i.test(`${labelFor(e)} ${e.name} ${e.id} ${e.getAttribute("data-automation-id") || ""} ${e.placeholder || ""}`));

  async function account(pw) {
    const email = ctx.config?.profile?.email || "";
    if (!email) return needs(["Add your email to your JobPilot profile"], "Can't create an account without an email.");
    let acct = await bg("api", { path: `/api/ext/site-account?host=${encodeURIComponent(host)}` });

    // Get to the right form: sign-up when we have no account here, sign-in when we do.
    if (!acct.exists && pw.length < 2) {
      const signUp = findButton(/^(create (an |your )?account|sign up|register( now| here)?|new user.*|don'?t have an account.*|join( now)?)$/i);
      if (signUp) { press(signUp); await waitFor(() => passwords().length >= 2, 8000); }
    } else if (acct.exists && pw.length >= 2) {
      const signIn = findButton(/^(sign in|log ?in|already have an account.*)$/i);
      if (signIn) { press(signIn); await waitFor(() => passwords().length === 1, 8000); }
    }
    pw = passwords();
    if (!pw.length) return null;
    const creating = pw.length >= 2;
    if (!creating && !acct.exists) {
      return needs([`Sign in on ${host}`], "This site only has a sign-in form and JobPilot has no account here.");
    }
    const password = acct.exists ? acct.password : newPassword();
    if (creating && !acct.exists) {
      // Saved before submitting, so the password is never lost.
      await bg("api", { path: "/api/ext/site-account", method: "PUT", body: { host, email, password } });
      acct = { exists: true, email, password };
      await log(`Creating an account on ${host} with ${email} (password saved in JobPilot).`);
    } else {
      await log(`Signing in on ${host}…`);
    }
    for (const e of emailInputs()) setValue(e, acct.email || email);
    for (const e of pw) setValue(e, password);
    if (creating) {
      const mails = new Set(emailInputs());
      const rest = collectFields(document).filter((f) => !(f.el && mails.has(f.el)));
      for (const f of rest) {
        if (f.type === "checkbox" && !f.el.checked && /agree|accept|terms|privacy|consent|policy|acknowledge/i.test(f.label)) f.el.click();
      }
      const missing = await answerAndFill(task.jobId, rest.filter((f) => f.type !== "checkbox"), {});
      if (missing.length) return needs(missing, `Sign-up form on ${host} asks for something JobPilot doesn't know.`);
    }
    await pause(600, 1200);
    const btn = creating
      ? findButton(/^(create( my)? account|sign up|register|submit|continue|create)$/i)
        || document.querySelector("[data-automation-id='createAccountSubmitButton']")
      : findButton(/^(sign in|log ?in|login|continue|submit|next)$/i) || document.querySelector("[data-automation-id='signInSubmitButton']");
    const submit = btn || pw[0].form?.querySelector("button[type='submit'], input[type='submit']");
    if (!submit) return needs([`${creating ? "Create the account" : "Sign in"} on ${host}`], "Couldn't find the button.");
    press(submit);
    await sleep(6000);

    const body = text(document.body).slice(0, 6000);
    if (passwords().length) {
      if (creating && /already (exists|registered|in use|have an account)|account with this e-?mail/i.test(body)) {
        return needs([`An account for ${email} already exists on ${host} — sign in once`],
          "You already had an account here; JobPilot doesn't know that password.");
      }
      if (/invalid|incorrect|wrong|doesn'?t match|not recogni[sz]ed|password must|at least \d+ characters/i.test(body)) {
        return needs(visibleErrors().length ? visibleErrors() : [`${creating ? "Sign-up" : "Sign-in"} failed on ${host}`],
          `${creating ? "Sign-up" : "Sign-in"} was rejected.`);
      }
    }
    if (VERIFY.test(body)) {
      const r = await verify();
      return r === "continue" ? null : r;
    }
    return null;
  }

  // "Verify your email": find the link (or code) in the connected mailbox and use it.
  async function verify() {
    await log(`Waiting for ${host}'s verification email…`);
    for (let i = 0; i < 18; i++) { // ~3 minutes
      const v = await bg("api", { path: `/api/ext/verification?host=${encodeURIComponent(host)}&since_minutes=15` }).catch(() => ({}));
      if (v.error === "no_mailbox") {
        return needs(["Connect your Gmail in JobPilot → Integrations (job-alert emails) so accounts can be verified automatically",
          `Verify your email for ${host}`], "Account created; it needs email verification.");
      }
      if (v.url) {
        await log(`Opening ${host}'s verification link…`);
        await bg("openAndClose", { url: v.url });
        const acct = await bg("api", { path: `/api/ext/site-account?host=${encodeURIComponent(host)}` });
        if (acct.exists) {
          await bg("api", { path: "/api/ext/site-account", method: "PUT",
            body: { host, email: acct.email, password: acct.password, verified: true } }).catch(() => {});
        }
        location.href = task.url; // back to the job; the next page load signs in and continues
        return null;
      }
      if (v.code) {
        const box = inputsHere().find((e) => /code|otp|verif|pin/i.test(`${labelFor(e)} ${e.name} ${e.id} ${e.placeholder || ""}`)) || inputsHere()[0];
        if (box) {
          await log(`Entering ${host}'s verification code…`);
          setValue(box, v.code);
          const b = findButton(/^(verify|submit|continue|confirm|next)$/i);
          if (b) press(b);
          await sleep(5000);
          return "continue";
        }
      }
      await sleep(10000);
    }
    return needs([`Verify your email for ${host}`], "The verification email didn't arrive in 3 minutes.");
  }

  // ------------------------------------------------------------------------------------------ go

  const title = text(document.querySelector("h1, .app-title, .posting-headline h2, [class*='job-title'], [data-automation-id='jobPostingHeader']")) || task.label;
  const company = (task.label || "").split(":")[0];
  let outcome;
  try {
    const prep = await bg("api", { path: `/api/ext/jobs/${task.jobId}/prepare`, method: "POST" });
    if (prep.decision !== "apply") {
      await log(`Skip: ${title} — ${prep.reason}`);
      await bg("outcome", { outcome: "skipped" });
      return bg("stepDone", {});
    }
    outcome = await run();
  } catch (e) {
    outcome = { outcome: "failed", note: e.message };
  }
  if (!outcome) return; // the page navigated; the next page load continues this job
  await bg("api", { path: "/api/ext/result", method: "POST", body: { job_id: task.jobId, outcome: outcome.outcome,
    note: outcome.note || "", missing: outcome.missing || [], apply_url: location.href } }).catch(() => {});
  await bg("outcome", { outcome: outcome.outcome, jobId: task.jobId, title, company, url: location.href,
    missing: outcome.missing, platform: "company" });
  await log(`${outcome.outcome === "submitted" ? "✅ Applied" : outcome.outcome === "needs_you" ? "✋ Left open for you" : "⚠️ Failed"}: ${title}${outcome.missing?.length ? ` (${outcome.missing.join("; ")})` : ""}${outcome.note && outcome.outcome !== "submitted" ? ` — ${outcome.note}` : ""}`);
  bg("stepDone", { keepTab: outcome.outcome === "needs_you" });
})();
