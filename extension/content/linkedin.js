// LinkedIn: Easy Apply on search results, and connection requests to people at companies applied to.
(async () => {
  const { sleep, pause, waitFor, text, visible, byText, bg, log, setValue, setFile, collectFields, answerAndFill, debugDump } = window.JP;
  if (window.__jpLinkedIn) return;
  window.__jpLinkedIn = true;

  await sleep(2500);
  let ctx;
  try { ctx = await bg("getTask"); } catch (_) { return; }
  if (!ctx || !ctx.task) return;
  const { task } = ctx;

  if (/\/(login|checkpoint|authwall|uas\/login)/.test(location.pathname)) {
    await log("LinkedIn is asking you to log in / verify. Log in to LinkedIn in this Chrome, then press Start again.");
    return bg("stepDone", { note: "LinkedIn needs login.", keepTab: true });
  }

  try {
    if (task.kind === "linkedin-search") await collectJobs(ctx);
    else if (task.kind === "linkedin-job") await jobPage(ctx);
    else if (task.kind === "linkedin-outreach") await outreach(ctx);
  } catch (e) {
    await log(`Error: ${e.message}`);
  }
  bg("stepDone", task.kind === "linkedin-outreach" ? { outreachDone: task.job.jobId } : {});

  // ------------------------------------------------------------------------------------- Easy Apply

  const CARD_LINK = "a[href*='/jobs/view/'], a[href*='currentJobId='], a.job-card-list__title, a.job-card-container__link, a.job-card-list__title--link";
  function cards() {
    const found = [...document.querySelectorAll("li[data-occludable-job-id], [data-job-id], li.jobs-search-results__list-item, div.job-card-container, li.scaffold-layout__list-item")]
      .filter((c) => c.querySelector(CARD_LINK) || c.matches("[data-job-id], [data-occludable-job-id]"));
    // Outermost card only (some layouts nest data-job-id inside the li).
    return found.filter((c) => !found.some((o) => o !== c && o.contains(c)));
  }
  function cardLink(card) {
    return card.querySelector(CARD_LINK) || card.querySelector("a[href*='/jobs/']") || card;
  }
  function cardJobId(card) {
    const id = card.getAttribute("data-occludable-job-id") || card.getAttribute("data-job-id")
      || card.querySelector("[data-job-id]")?.getAttribute("data-job-id");
    const href = cardLink(card).href || "";
    return id || (href.match(/\/jobs\/view\/(\d+)/) || href.match(/currentJobId=(\d+)/) || [])[1] || "";
  }
  function findEasyApply() {
    return [...document.querySelectorAll("button, a")].find((b) => visible(b) && !b.closest(".job-card-container, li[data-occludable-job-id]")
      && (/^Easy Apply$/i.test(text(b)) || /Easy Apply to/i.test(b.getAttribute("aria-label") || "")));
  }

  async function loadAllCards() {
    const list = document.querySelector(".jobs-search-results-list, .scaffold-layout__list > div, .scaffold-layout__list");
    for (let i = 0; i < 8 && list; i++) {
      list.scrollBy(0, 600);
      await sleep(500);
    }
    if (list) list.scrollTo(0, 0);
  }

  function details() {
    const pane = document.querySelector(".jobs-search__job-details--container, .jobs-details, .job-view-layout") || document;
    const title = text(pane.querySelector(".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1, h2.t-24"))
      || text(document.querySelector("h1"));
    const company = text(pane.querySelector(".job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, a[href*='/company/']"))
      || text(document.querySelector(".job-details-jobs-unified-top-card__company-name a, a[href*='/company/'][class*='company']"));
    const meta = text(pane.querySelector(".job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__tertiary-description-container, .jobs-unified-top-card__primary-description"));
    const desc = text(pane.querySelector("#job-details, .jobs-description__content, .jobs-box__html-content, [class*='jobs-description']"))
      || text(document.querySelector("#job-details, article, [class*='description']"));
    const location = meta.split("·")[0].trim();
    const wp = /remote/i.test(meta + text(pane.querySelector(".job-details-preferences-and-skills, .job-details-fit-level-preferences")))
      ? "remote" : /hybrid/i.test(meta) ? "hybrid" : /on-?site/i.test(meta) ? "onsite" : "unknown";
    return { title, company, location, description: desc, workplace_type: wp };
  }

  // Works with both the old (/jobs/search/) and new (/jobs/search-results/) layouts: gather job ids from links,
  // data attributes and the page source, then visit each job's own page.
  function jobIdsOnPage() {
    const ids = new Set();
    document.querySelectorAll("[data-job-id], [data-occludable-job-id]").forEach((e) => {
      const v = e.getAttribute("data-job-id") || e.getAttribute("data-occludable-job-id");
      if (/^\d{6,}$/.test(v)) ids.add(v);
    });
    document.querySelectorAll("a[href*='/jobs/view/'], a[href*='currentJobId=']").forEach((a) => {
      const m = a.href.match(/\/jobs\/view\/(\d{6,})/) || a.href.match(/currentJobId=(\d{6,})/);
      if (m) ids.add(m[1]);
    });
    for (const m of document.documentElement.innerHTML.matchAll(/(?:jobPosting|fsd_jobPosting|jobPostingCard)[:(,](\d{8,})/g)) ids.add(m[1]);
    return [...ids];
  }

  async function collectJobs() {
    await waitFor(() => jobIdsOnPage().length, 15000);
    // Scroll whatever list is on the page so lazy-loaded jobs render.
    const scrollers = [...document.querySelectorAll("div, ul, main")].filter((e) => e.scrollHeight > e.clientHeight + 200
      && /auto|scroll/.test(getComputedStyle(e).overflowY));
    for (let i = 0; i < 10; i++) {
      scrollers.forEach((e) => e.scrollBy(0, 700));
      window.scrollBy(0, 700);
      await sleep(600);
    }
    const ids = jobIdsOnPage().slice(0, 25);
    await log(`LinkedIn: ${ids.length} jobs found on this search.`);
    if (ids.length < 3) await debugDump("linkedin-search");
    if (ids.length) {
      await bg("insertSteps", { steps: ids.map((id) => ({ kind: "linkedin-job", url: `https://www.linkedin.com/jobs/view/${id}/`,
        label: `LinkedIn job ${id}` })) });
    }
  }

  function topCard() {
    const title = text(document.querySelector(".job-details-jobs-unified-top-card__job-title h1, .job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1"));
    const company = text(document.querySelector(".job-details-jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name a, a[href*='/company/'] span, a[href*='/company/']"));
    const meta = text(document.querySelector(".job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__tertiary-description-container, .jobs-unified-top-card__primary-description, .job-details-jobs-unified-top-card__container--two-pane"));
    const prefs = text(document.querySelector(".job-details-preferences-and-skills, .job-details-fit-level-preferences, .jobs-unified-top-card__job-insight"));
    const description = text(document.querySelector("#job-details, .jobs-description__content, .jobs-box__html-content, [class*='jobs-description'], article"));
    const wp = /remote/i.test(meta + prefs) ? "remote" : /hybrid/i.test(meta + prefs) ? "hybrid" : /on-?site/i.test(meta + prefs) ? "onsite" : "unknown";
    return { title, company, location: meta.split("·")[0].trim(), description, workplace_type: wp };
  }

  async function jobPage({ remaining }) {
    if (remaining <= 0) return;
    await waitFor(() => text(document.querySelector("h1")), 12000);
    await waitFor(() => text(document.querySelector("#job-details, .jobs-description__content, [class*='jobs-description'], article")), 6000);
    await sleep(1200);
    const d = topCard();
    if (!d.title || !d.company) {
      await log(`Could not read LinkedIn job ${location.pathname} (title="${d.title}", company="${d.company}").`);
      return debugDump("linkedin-job");
    }
    if (/\bApplied\b.{0,40}ago|Application submitted/i.test(text(document.querySelector("main") || document.body).slice(0, 4000))) {
      return log(`Already applied: ${d.title} @ ${d.company}`);
    }
    const easy = findEasyApply();
    if (!easy) {
      await log(`Skip: ${d.title} @ ${d.company} — not Easy Apply (applies on company site)`);
      return bg("outcome", { outcome: "skipped" });
    }
    const jobUrl = location.href.split("?")[0];
    const ev = await bg("api", { path: "/api/ext/evaluate", method: "POST", body: { platform: "linkedin", url: jobUrl, ...d } });
    if (ev.decision !== "apply") {
      await log(`Skip: ${d.title} @ ${d.company} — ${ev.reason}`);
      return bg("outcome", { outcome: "skipped" });
    }
    await log(`Applying (${ev.score}): ${d.title} @ ${d.company}`);
    const resume = await bg("resume", { jobId: ev.job_id });
    easy.click();
    const res = await easyApply(ev.job_id, resume);
    await bg("api", { path: "/api/ext/result", method: "POST",
      body: { job_id: ev.job_id, outcome: res.outcome, note: res.note, missing: res.missing || [] } });
    await bg("outcome", { outcome: res.outcome, jobId: ev.job_id, title: d.title, company: d.company,
      url: jobUrl, missing: res.missing, platform: "linkedin" });
    await log(`${res.outcome === "submitted" ? "✅ Applied" : res.outcome === "needs_you" ? "✋ Needs you" : "⚠️ Failed"}: ${d.title} @ ${d.company}${res.missing?.length ? ` (${res.missing.join("; ")})` : ""}${res.outcome === "failed" ? ` — ${res.note}` : ""}`);
  }

  async function searchPage({ remaining }) {
    await waitFor(() => cards().length, 15000);
    await loadAllCards();
    const all = cards();
    if (!all.length) {
      return log(`No job cards found (page: ${location.pathname}; links to jobs: ${document.querySelectorAll("a[href*='/jobs/view/'], a[href*='currentJobId=']").length}).`);
    }
    await log(`${all.length} jobs on this page.`);
    let left = remaining;
    for (const card of all) {
      if (left <= 0) return log("Daily cap reached.");
      if (/\bApplied\b/.test(text(card))) continue;
      const link = cardLink(card);
      const jid = cardJobId(card);
      const jobUrl = jid ? `https://www.linkedin.com/jobs/view/${jid}/` : (link.href || location.href).split("?")[0];
      const before = text(document.querySelector(".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title"));
      link.click();
      await waitFor(() => {
        const t = text(document.querySelector(".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title"));
        return t && t !== before;
      }, 10000);
      await waitFor(() => text(document.querySelector("#job-details, .jobs-description__content, [class*='jobs-description']")), 5000);
      await pause(1200, 2500);
      const d = details();
      if (!d.title || !d.company) { await log(`Could not read job details (card ${jid || "?"}).`); continue; }

      const easy = findEasyApply();
      if (!easy) {
        const ext = byText("button, a", /^Apply( on company website)?$/i);
        await log(`Skip: ${d.title} @ ${d.company} — ${ext ? "applies on company site, not Easy Apply" : "no Easy Apply button found"}`);
        await bg("outcome", { outcome: "skipped" });
        continue;
      }

      let ev;
      try {
        ev = await bg("api", { path: "/api/ext/evaluate", method: "POST", body: { platform: "linkedin", url: jobUrl, ...d } });
      } catch (e) { await log(`Evaluate failed: ${e.message}`); continue; }
      if (ev.decision !== "apply") {
        await log(`Skip: ${d.title} @ ${d.company} — ${ev.reason}`);
        await bg("outcome", { outcome: "skipped" });
        continue;
      }
      await log(`Applying (${ev.score}): ${d.title} @ ${d.company}`);
      const resume = await bg("resume", { jobId: ev.job_id });
      easy.click();
      const res = await easyApply(ev.job_id, resume);
      await bg("api", { path: "/api/ext/result", method: "POST",
        body: { job_id: ev.job_id, outcome: res.outcome, note: res.note, missing: res.missing || [] } });
      const r = await bg("outcome", { outcome: res.outcome, jobId: ev.job_id, title: d.title, company: d.company,
        url: jobUrl, missing: res.missing, platform: "linkedin" });
      await log(`${res.outcome === "submitted" ? "✅ Applied" : res.outcome === "needs_you" ? "✋ Needs you" : "⚠️ Failed"}: ${d.title} @ ${d.company}${res.missing?.length ? ` (${res.missing.join("; ")})` : ""}`);
      left = r.remaining;
      if (r.stop) return;
      await pause(2500, 5000);
    }
  }

  const modalSel = ".jobs-easy-apply-modal, [data-test-modal-id='easy-apply-modal'], div[role='dialog'].artdeco-modal";
  const modal = () => [...document.querySelectorAll(modalSel)].find(visible);

  async function easyApply(jobId, resume) {
    const m0 = await waitFor(modal, 10000);
    if (!m0) return { outcome: "failed", note: "Easy Apply window did not open." };
    let lastStepKey = "";
    let sameCount = 0;
    for (let step = 0; step < 15; step++) {
      await pause(800, 1500);
      const m = modal();
      if (!m) break;
      if (/application (was )?sent|your application was sent|applied/i.test(text(m)) && !m.querySelector("form, input, select, textarea")) {
        await closeModal();
        return { outcome: "submitted", note: "LinkedIn Easy Apply" };
      }
      // Use the tailored resume for this job.
      const up = m.querySelector("input[type='file'][id*='upload-resume'], input[type='file'][name='file'], input[type='file']");
      if (up && resume && !up.dataset.jpDone && !/cover/i.test(up.id + up.name)) {
        await setFile(up, resume.b64, resume.filename);
        up.dataset.jpDone = "1";
        await sleep(3500);
      }
      const follow = m.querySelector("input#follow-company-checkbox");
      if (follow && follow.checked) m.querySelector("label[for='follow-company-checkbox']")?.click();

      const fields = collectFields(m).filter((f) => f.type !== "file" && f.el?.id !== "follow-company-checkbox");
      const missing = await answerAndFill(jobId, fields, {});
      await pickTypeaheads(m);
      if (missing.length) {
        await discard();
        return { outcome: "needs_you", missing, note: "Questions only you can answer." };
      }

      const submit = m.querySelector("button[aria-label*='Submit application']") || byText("button", /^Submit application$/i, m);
      const review = m.querySelector("button[aria-label*='Review your application']") || byText("button", /^Review$/i, m);
      const next = m.querySelector("button[aria-label*='Continue to next step']") || byText("button", /^Next$/i, m);
      const btn = submit || review || next;
      if (!btn) return { outcome: "failed", note: "No Next/Submit button found." };
      btn.click();
      await sleep(2000);
      if (submit) {
        const done = await waitFor(() => !modal() || /application (was )?sent|applied/i.test(text(modal())), 10000);
        await closeModal();
        return done ? { outcome: "submitted", note: "LinkedIn Easy Apply" } : { outcome: "failed", note: "No confirmation after submit." };
      }
      const errs = [...(modal()?.querySelectorAll(".artdeco-inline-feedback--error, [data-test-form-element-error-messages]") || [])].filter(visible);
      if (errs.length) {
        const key = errs.map(text).join("|");
        sameCount = key === lastStepKey ? sameCount + 1 : 0;
        lastStepKey = key;
        if (sameCount >= 1) {
          const labels = errs.map((e) => {
            const g = e.closest("[data-test-form-element], .jobs-easy-apply-form-element, .fb-dash-form-element, fieldset, div");
            return text(g?.querySelector("label, legend, span[aria-hidden='true']")) || text(e);
          });
          await discard();
          return { outcome: "needs_you", missing: [...new Set(labels)].slice(0, 8), note: "LinkedIn rejected some answers." };
        }
      }
    }
    await discard();
    return { outcome: "failed", note: "Easy Apply had too many steps." };
  }

  async function pickTypeaheads(m) {
    for (const opt of [...m.querySelectorAll(".basic-typeahead__selectable, [role='option']")].filter(visible).slice(0, 1)) {
      opt.click();
      await sleep(500);
    }
  }

  async function closeModal() {
    await sleep(1500);
    const x = [...document.querySelectorAll("button[aria-label='Dismiss'], button[aria-label='Done']")].find(visible)
      || byText("button", /^(Done|Not now)$/i);
    if (x) x.click();
    await sleep(800);
  }

  async function discard() {
    const x = [...document.querySelectorAll("button[aria-label='Dismiss']")].find(visible);
    if (x) x.click();
    const confirm = await waitFor(() => document.querySelector("button[data-control-name='discard_application_confirm_btn']")
      || byText("button", /^Discard$/i), 5000);
    if (confirm) confirm.click();
    await sleep(1200);
  }

  // ---------------------------------------------------------------------------------------- outreach

  async function outreach({ task, settings, outreachLeft }) {
    const job = task.job;
    await waitFor(() => document.querySelector(".reusable-search__result-container, [data-chameleon-result-urn], .search-results-container li, [data-view-name='search-entity-result-universal-template']"), 15000);
    await sleep(1500);
    const results = [...document.querySelectorAll(".reusable-search__result-container, li:has([data-chameleon-result-urn]), [data-view-name='search-entity-result-universal-template']")];
    let sent = 0;
    const cap = Math.min(settings.perCompany || 2, outreachLeft);
    const company = job.company.toLowerCase();
    for (const r of results) {
      if (sent >= cap) break;
      const t = text(r).toLowerCase();
      if (!t.includes(company.split(" ")[0])) continue; // must actually work there
      const connect = [...r.querySelectorAll("button")].find((b) => /^Connect$/i.test(text(b)) || /Invite .* to connect/i.test(b.getAttribute("aria-label") || ""));
      if (!connect) continue;
      const name = text(r.querySelector(".entity-result__title-text a span[aria-hidden='true'], a[href*='/in/'] span[aria-hidden='true']")) || "";
      const title = text(r.querySelector(".entity-result__primary-subtitle, .t-14.t-black.t-normal")) || "";
      const profileUrl = (r.querySelector("a[href*='/in/']")?.href || "").split("?")[0];
      if (!name) continue;
      const { note } = await bg("api", { path: "/api/ext/outreach-note", method: "POST",
        body: { job_id: job.jobId, person_name: name, person_title: title } });
      connect.click();
      const dlg = await waitFor(() => [...document.querySelectorAll("div[role='dialog']")].find(visible), 6000);
      if (!dlg) continue;
      if (dlg.querySelector("input[type='email']")) { // LinkedIn wants their email address: skip this person
        dlg.querySelector("button[aria-label='Dismiss']")?.click();
        continue;
      }
      let usedNote = "";
      const addNote = byText("button", /^Add a note$/i, dlg);
      if (addNote) {
        addNote.click();
        const ta = await waitFor(() => document.querySelector("textarea#custom-message, textarea[name='message']"), 4000);
        if (ta) { setValue(ta, note); usedNote = note; await sleep(800); }
      }
      const send = await waitFor(() => {
        const d = [...document.querySelectorAll("div[role='dialog']")].find(visible);
        return d && ([...d.querySelectorAll("button")].find((b) => /^Send( now| invitation)?$/i.test(text(b)) && !b.disabled)
          || [...d.querySelectorAll("button")].find((b) => /^Send without a note$/i.test(text(b))));
      }, 5000);
      if (!send) {
        document.querySelector("div[role='dialog'] button[aria-label='Dismiss']")?.click();
        continue;
      }
      if (/without a note/i.test(text(send))) usedNote = "";
      send.click();
      await sleep(1500);
      // Premium upsell ("You've used your free personalised invitations") → close it and send plain.
      const upsell = [...document.querySelectorAll("div[role='dialog']")].find(visible);
      if (upsell) {
        const plain = byText("button", /Send without a note/i, upsell);
        if (plain) { plain.click(); usedNote = ""; await sleep(1200); } else upsell.querySelector("button[aria-label='Dismiss']")?.click();
      }
      await bg("api", { path: "/api/ext/outreach-log", method: "POST",
        body: { job_id: job.jobId, person_name: name, person_title: title, profile_url: profileUrl, note: usedNote } });
      await bg("outcome", { outcome: "outreach", platform: "outreach" });
      await log(`🤝 Connection request → ${name} (${title})${usedNote ? " with note" : ""}`);
      sent += 1;
      await pause(4000, 9000);
    }
    if (!sent) await log(`No one to connect with at ${job.company} on this page.`);
  }
})();
