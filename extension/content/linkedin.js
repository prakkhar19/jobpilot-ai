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
  // querySelectorAll that also looks inside open shadow roots (LinkedIn's newer pages use them).
  // Also looks inside same-origin iframes: LinkedIn now renders much of the job page (and the Easy Apply form) in
  // an embedded "/preload/" frame.
  function deepAll(root, sel) {
    const out = [...root.querySelectorAll(sel)];
    root.querySelectorAll("*").forEach((e) => {
      // Closed shadow roots too (LinkedIn's "interop-shadowdom" host): only extensions can open those.
      let sr = e.shadowRoot;
      if (!sr && chrome.dom?.openOrClosedShadowRoot) { try { sr = chrome.dom.openOrClosedShadowRoot(e); } catch (_) { sr = null; } }
      if (sr) out.push(...deepAll(sr, sel));
      if (e.tagName === "IFRAME") {
        let d = null;
        try { d = e.contentDocument; } catch (_) { /* cross-origin */ }
        if (d && d.body && visible(e)) out.push(...deepAll(d, sel));
      }
    });
    return out;
  }

  // Is el the thing actually on top at its centre (not covered by LinkedIn's full-page frame or an overlay)?
  function onTop(el) {
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const fe = el.ownerDocument.defaultView?.frameElement;
    if (fe) {
      const fr = fe.getBoundingClientRect();
      if (document.elementFromPoint(x + fr.left, y + fr.top) !== fe) return false;
    }
    const hit = el.ownerDocument.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit));
  }

  function findEasyApply() {
    const all = deepAll(document, "button, a, [role='button']").filter((b) => visible(b) && !b.closest(".job-card-container, li[data-occludable-job-id]")
      && (/^Easy Apply$/i.test(text(b)) || /Easy Apply to/i.test(b.getAttribute("aria-label") || "")));
    const best = all.find(onTop) || all[all.length - 1];
    if (all.length) log(`EASY-CANDIDATES ${all.length}: ${all.map((b) => `${b.ownerDocument !== document ? "frame" : "top"}/${onTop(b) ? "onTop" : "covered"}`).join(", ")}`);
    return best;
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

  // LinkedIn's non-Easy-Apply button ("Apply", "Apply on company website"), which opens the employer's site.
  function externalApply() {
    const root = document.querySelector(".jobs-apply-button--top-card, .jobs-s-apply, .job-details-jobs-unified-top-card__container--two-pane, main") || document;
    return byText("button, a", /^Apply( on company (website|site))?$/i, root)
      || deepAll(document, "button, a, [role='button']").find((b) => visible(b) && /^Apply( on company (website|site))?$/i.test(text(b)))
      || [...root.querySelectorAll("button[aria-label], a[aria-label]")].find((b) => visible(b)
        && /^Apply\b/i.test(b.getAttribute("aria-label")) && /company|website|on .+ site/i.test(b.getAttribute("aria-label")));
  }

  // LinkedIn's newer job page has no h1 and hashed class names: fall back to the tab title ("Role | Company | LinkedIn"),
  // the link to this job, and the "About the job" section.
  function pageTitle() {
    const parts = document.title.replace(/^\(\d+\+?\)\s*/, "").split(" | ").map((x) => x.trim());
    if (parts.length >= 3 && /linkedin/i.test(parts[parts.length - 1])) return parts[0];
    const id = (location.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1];
    if (!id) return "";
    const a = [...document.querySelectorAll(`main a[href*='/jobs/view/${id}']`)].map((x) => text(x)).find((t) => t && t.length < 150);
    return a || "";
  }
  function aboutJob() {
    const h = [...document.querySelectorAll("h2, h3, span, div")].find((e) => e.childElementCount === 0 && /^About the job$/i.test(text(e)));
    let box = h;
    for (let i = 0; box && i < 4 && text(box).length < 300; i++) box = box.parentElement;
    return box ? text(box) : "";
  }

  function topCard() {
    const title = text(document.querySelector(".job-details-jobs-unified-top-card__job-title h1, .job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1")) || pageTitle();
    const company = text(document.querySelector(".job-details-jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name a, a[href*='/company/'] span, a[href*='/company/']"));
    const meta = text(document.querySelector(".job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__tertiary-description-container, .jobs-unified-top-card__primary-description, .job-details-jobs-unified-top-card__container--two-pane"));
    const prefs = text(document.querySelector(".job-details-preferences-and-skills, .job-details-fit-level-preferences, .jobs-unified-top-card__job-insight"));
    const description = text(document.querySelector("#job-details, .jobs-description__content, .jobs-box__html-content, [class*='jobs-description'], article")) || aboutJob();
    const wp = /remote/i.test(meta + prefs) ? "remote" : /hybrid/i.test(meta + prefs) ? "hybrid" : /on-?site/i.test(meta + prefs) ? "onsite" : "unknown";
    return { title, company, location: meta.split("·")[0].trim(), description, workplace_type: wp };
  }

  async function jobPage({ remaining }) {
    if (remaining <= 0) return;
    await waitFor(() => text(document.querySelector("h1")) || (pageTitle() && document.querySelector("a[href*='/company/']")), 12000);
    await waitFor(() => text(document.querySelector("#job-details, .jobs-description__content, [class*='jobs-description'], article")) || aboutJob(), 6000);
    await sleep(1200);
    const d = topCard();
    if (!d.title || !d.company) {
      await log(`Could not read LinkedIn job ${location.pathname} (title="${d.title}", company="${d.company}").`);
      return debugDump("linkedin-job");
    }
    if (/\bApplied\b.{0,40}ago|Application submitted/i.test(text(document.querySelector("main") || document.body).slice(0, 4000))) {
      return log(`Already applied: ${d.title} @ ${d.company}`);
    }
    const onApplyPath = /\/jobs\/view\/\d+\/apply\b/.test(location.pathname);
    const easy = onApplyPath ? null : findEasyApply();
    if (onApplyPath) {
      // Opened LinkedIn's direct apply link (the button click didn't open the form): the form should be up.
      const ev = await bg("api", { path: "/api/ext/evaluate", method: "POST", body: { platform: "linkedin", url: location.href.replace(/\/apply.*$/, "/"), ...d } });
      if (ev.decision !== "apply") return bg("outcome", { outcome: "skipped" });
      return finishEasy(ev, d, location.href.replace(/\/apply.*$/, "/"), true);
    }
    const external = easy ? null : externalApply();
    if (!easy && !external) {
      await log(`Skip: ${d.title} @ ${d.company} — no Apply button (closed or already applied?)`);
      await debugDump("linkedin-noapply", document.querySelector("main") || document.body);
      // Every element mentioning "apply" (incl. open shadow roots), to learn the new layout's Apply control.
      const hits = deepAll(document, "*").filter((e) => e.childElementCount <= 3 && /apply/i.test(text(e) + " " + (e.getAttribute("aria-label") || ""))
        && text(e).length < 60).slice(0, 12)
        .map((e) => `${e.tagName}${e.getAttribute("role") ? "[" + e.getAttribute("role") + "]" : ""} "${text(e)}" aria=${(e.getAttribute("aria-label") || "").slice(0, 50)} href=${(e.getAttribute("href") || "").slice(0, 90)} shadow=${e.getRootNode() !== document} vis=${visible(e)}`);
      await log(`APPLY-ELEMENTS ${hits.join(" || ").slice(0, 1400)}`);
      return bg("outcome", { outcome: "skipped" });
    }
    const jobUrl = location.href.split("?")[0];
    const ev = await bg("api", { path: "/api/ext/evaluate", method: "POST", body: { platform: "linkedin", url: jobUrl, ...d } });
    if (ev.decision !== "apply") {
      await log(`Skip: ${d.title} @ ${d.company} — ${ev.reason}`);
      return bg("outcome", { outcome: "skipped" });
    }
    if (!easy) {
      await window.JP.viaCompanySite(external, ev, d, "linkedin", jobUrl);
      return;
    }
    await log(`Applying (${ev.score}): ${d.title} @ ${d.company}`);
    await log(`EASY-BTN ${easy.tagName} "${text(easy).slice(0, 40)}" aria=${(easy.getAttribute("aria-label") || "").slice(0, 60)} href=${(easy.getAttribute("href") || "").slice(0, 120)} inFrame=${easy.ownerDocument !== document}`);
    const allText = () => deepAll(document, "body").map((b) => b.innerText || "").join("\n");
    const beforeLines = new Set(allText().split("\n").map((l) => l.trim()).filter(Boolean));
    const urlBefore = location.href;
    easy.click();
    if (!(await waitFor(modal, 4000))) {
      const r = await tclick(easy);
      if (!r.ok) await log(`Trusted click failed: ${r.error || "?"}`);
      if (!(await waitFor(modal, 6000))) {
        const host = document.querySelector("[data-testid='interop-shadowdom']");
        let sr = null;
        try { sr = host && chrome.dom?.openOrClosedShadowRoot(host); } catch (_) { /* ignore */ }
        const fresh = [...new Set(allText().split("\n").map((l) => l.trim()).filter((l) => l && !beforeLines.has(l)))].slice(0, 25);
        const toast = deepAll(document, "[data-testid='toasts-title'], [role='alert'], [aria-live]").map((t) => text(t)).filter(Boolean).slice(0, 5);
        await log(`EASY-AFTER urlChanged=${location.href !== urlBefore} url=${location.href.slice(0, 120)} toast=${JSON.stringify(toast).slice(0, 300)} new=${JSON.stringify(fresh).slice(0, 1000)}`);
        await log(`EASY-SHADOW host=${!!host} root=${!!sr} kids=${sr ? sr.childElementCount : 0} text="${sr ? text(sr).slice(0, 200) : ""}"`);
      }
    }
    return finishEasy(ev, d, jobUrl, false);
  }

  // A real mouse click (via the extension's debugger access) on an element of this tab, including elements inside
  // the same-origin page frame (their coordinates are offset by the frame's position).
  async function tclick(el) {
    el.scrollIntoView({ block: "center" });
    await sleep(400);
    const r = el.getBoundingClientRect();
    let x = r.left + r.width / 2, y = r.top + r.height / 2;
    const fe = el.ownerDocument.defaultView?.frameElement;
    if (fe) { const fr = fe.getBoundingClientRect(); x += fr.left; y += fr.top; }
    return bg("trustedClick", { x, y });
  }

  // Pointer + mouse events with coordinates, for buttons that ignore a bare .click().
  function realClick(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, view: el.ownerDocument.defaultView };
    for (const t of ["pointerover", "pointerenter", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(t.startsWith("pointer") ? new PointerEvent(t, { ...o, pointerType: "mouse", isPrimary: true }) : new MouseEvent(t, o));
    }
  }

  async function finishEasy(ev, d, jobUrl, viaLink) {
    const resume = await bg("resume", { jobId: ev.job_id });
    if (viaLink) await log(`Applying (${ev.score}) via the apply link: ${d.title} @ ${d.company}`);
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
        // The one-page search flow only does Easy Apply; company-site jobs are handled on their own job page.
        const ext = externalApply();
        if (ext && jid) {
          await bg("insertSteps", { steps: [{ kind: "linkedin-job", url: jobUrl, label: `LinkedIn job ${jid} (company site)` }] });
          await log(`${d.title} @ ${d.company} applies on the company site — queued.`);
        } else {
          await log(`Skip: ${d.title} @ ${d.company} — no Apply button found`);
          await bg("outcome", { outcome: "skipped" });
        }
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

  // Function declarations (hoisted): the page handler at the top of this file runs before later consts exist.
  function modal() {
    const sel = ".jobs-easy-apply-modal, [data-test-modal-id='easy-apply-modal'], div[role='dialog'].artdeco-modal";
    return deepAll(document, sel).find(visible)
      || deepAll(document, "[role='dialog']").find((d) => visible(d) && /apply|contact info|resume|submit/i.test(text(d).slice(0, 600)))
      || applyPanel();
  }

  // LinkedIn's newer Easy Apply isn't a role=dialog: find the "Apply to <Company>" heading and climb to the box that
  // also holds the step's Next / Review / Submit button.
  function applyPanel() {
    const head = deepAll(document, "h1, h2, h3, [role='heading'], span, div").find((e) => e.childElementCount <= 2 && visible(e)
      && /^Apply to .{2,120}$/.test(text(e)));
    if (!head) return null;
    const navBtn = (b) => /^(Next|Review|Submit application|Submit|Continue|Done)$/i.test(text(b))
      || /Continue to next step|Review your application|Submit application/i.test(b.getAttribute("aria-label") || "");
    let box = head.parentElement;
    for (let i = 0; box && i < 12; i++, box = box.parentElement) {
      if ([...box.querySelectorAll("button")].some((b) => visible(b) && navBtn(b))) return box;
      if (box === box.ownerDocument.body) break;
    }
    return null;
  }

  async function easyApply(jobId, resume) {
    const m0 = await waitFor(modal, 10000);
    if (!m0) {
      const frames = [...document.querySelectorAll("iframe")].map((f) => {
        let same = false, body = "";
        try { same = !!f.contentDocument; body = text(f.contentDocument?.body || null).slice(0, 120); } catch (_) { /* cross-origin */ }
        return `${(f.getAttribute("src") || "").slice(0, 90)} [${f.getAttribute("data-testid") || ""}] vis=${visible(f)} same=${same} "${body}"`;
      });
      const dialogs = deepAll(document, "[role='dialog'], dialog, [aria-modal='true']").map((d) => `${d.tagName} vis=${visible(d)} "${text(d).slice(0, 100)}"`);
      let furl = "";
      try { furl = document.querySelector("iframe[data-testid='interop-iframe']")?.contentWindow?.location.href || ""; } catch (_) { /* ignore */ }
      const hits = deepAll(document, "button, a, [role='button'], h2, h3").filter((e) => visible(e) && /apply|contact info|submit|next|resume/i.test(text(e) + (e.getAttribute("aria-label") || "")) && text(e).length < 80)
        .slice(0, 15).map((e) => `${e.tagName} "${text(e).slice(0, 40)}" aria=${(e.getAttribute("aria-label") || "").slice(0, 40)} href=${(e.getAttribute("href") || "").slice(0, 70)} f=${e.ownerDocument !== document}`);
      await log(`EASY-APPLY-DIAG2 frameUrl=${furl.slice(0, 150)} tabUrl=${location.href.slice(0, 120)} | ${hits.join(" || ")}`.slice(0, 1800));
      await log(`EASY-APPLY-DIAG url=${location.pathname}${location.search.slice(0, 80)} | FRAMES ${frames.join(" || ")} | DIALOGS ${dialogs.join(" || ")}`.slice(0, 1800));
      return { outcome: "failed", note: "Easy Apply window did not open." };
    }
    let lastStepKey = "";
    let sameCount = 0;
    let stuck = 0;
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
      const before = text(m).slice(0, 300);
      btn.click();
      await sleep(1500);
      if (modal() && text(modal()).slice(0, 300) === before) { await tclick(btn); await sleep(1500); }
      if (!submit && modal() && text(modal()).slice(0, 300) === before) {
        // The step didn't move on (an unanswered or rejected field): hand it to you instead of looping.
        stuck += 1;
        if (stuck >= 2) {
          const fs = collectFields(modal());
          await log(`EASY-STUCK btn="${text(btn)}" fields=${fs.length} [${fs.map((f) => `${f.label}=${String(f.el?.value || "").slice(0, 20)}`).join("; ").slice(0, 500)}] panel="${text(modal()).slice(0, 700)}"`);
          const empty = collectFields(modal()).filter((f) => f.type !== "file" && !String(f.el?.value || "").trim()).map((f) => f.label).filter(Boolean);
          await discard();
          return { outcome: "needs_you", missing: [...new Set(empty)].slice(0, 8).concat(empty.length ? [] : ["A step of the Easy Apply form"]),
            note: "LinkedIn didn't accept a step of the form." };
        }
      } else stuck = 0;
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
    const x = deepAll(document, "button[aria-label='Dismiss'], button[aria-label='Done']").find(visible)
      || byText("button", /^(Done|Not now)$/i);
    if (x) x.click();
    await sleep(800);
  }

  async function discard() {
    const x = deepAll(document, "button[aria-label='Dismiss']").find(visible);
    if (x) x.click();
    const confirm = await waitFor(() => deepAll(document, "button[data-control-name='discard_application_confirm_btn']")[0]
      || deepAll(document, "button").find((b) => visible(b) && /^Discard$/i.test(text(b))), 5000);
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
  // Runs last, so every const above is initialised before the page handlers use it.
  let r;
  try {
    if (task.kind === "linkedin-search") await collectJobs(ctx);
    else if (task.kind === "linkedin-job") r = await jobPage(ctx);
    else if (task.kind === "linkedin-outreach") await outreach(ctx);
  } catch (e) {
    await log(`Error: ${e.message}`);
  }
  if (r !== "navigated") bg("stepDone", task.kind === "linkedin-outreach" ? { outreachDone: task.job.jobId } : {});
})();
