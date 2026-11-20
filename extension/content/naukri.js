// Naukri: the search page queues each job page; each job page is evaluated and applied to, answering the
// recruiter's questionnaire (chat drawer) from the profile/answer bank.
(async () => {
  const { sleep, pause, waitFor, text, visible, byText, bg, log, setValue } = window.JP;
  if (window.__jpNaukri) return;
  window.__jpNaukri = true;

  await sleep(2500);
  let ctx;
  try { ctx = await bg("getTask"); } catch (_) { return; }
  if (!ctx || !ctx.task) return;
  const { task } = ctx;

  if (/nlogin|login/.test(location.pathname) || document.querySelector("#usernameField")) {
    await log("Naukri needs you to log in. Log in to Naukri in this Chrome, then press Start again.");
    return bg("stepDone", { keepTab: true });
  }

  try {
    if (task.kind === "naukri-search") await search();
    else if (task.kind === "naukri-job") await job(ctx);
  } catch (e) {
    await log(`Error: ${e.message}`);
  }
  bg("stepDone", {});

  async function search() {
    await waitFor(".srp-jobtuple-wrapper, article.jobTuple, .cust-job-tuple", 15000);
    const links = [...document.querySelectorAll(".srp-jobtuple-wrapper a.title, article.jobTuple a.title, .cust-job-tuple a.title")]
      .map((a) => ({ href: a.href.split("?")[0], title: text(a) }))
      .filter((x) => /naukri\.com\/job-listings-/.test(x.href));
    const uniq = [...new Map(links.map((l) => [l.href, l])).values()].slice(0, 20);
    await log(`Naukri: ${uniq.length} jobs found.`);
    await bg("insertSteps", { steps: uniq.map((l) => ({ kind: "naukri-job", url: l.href, label: `Naukri job: ${l.title}` })) });
  }

  function details() {
    const title = text(document.querySelector("h1, .styles_jd-header-title__rZwM1, .jd-header-title"));
    const company = text(document.querySelector(".styles_jd-header-comp-name__MvqAI a, .jd-header-comp-name a, [class*='comp-name'] a"));
    const location = text(document.querySelector(".styles_jhc__location__W_pVs, .location, [class*='location']"));
    const description = text(document.querySelector(".styles_JDC__dang-inner-html__h0K4t, .job-desc, [class*='dang-inner-html'], section[class*='job-desc']"));
    const wp = /remote|work from home/i.test(location + description.slice(0, 400)) ? "remote" : /hybrid/i.test(location) ? "hybrid" : "unknown";
    return { title, company: company.replace(/\s*\d(\.\d)?\s*\d*\s*Reviews?.*$/i, "").trim(), location, description, workplace_type: wp };
  }

  async function job({ remaining }) {
    if (remaining <= 0) return;
    await waitFor("h1", 12000);
    await sleep(1500);
    const d = details();
    if (!d.title || !d.company) return log("Could not read this Naukri job.");
    if (byText("button, span", /^Applied$/i)) return;
    const companySite = byText("button", /Apply on company site/i);
    const apply = document.querySelector("#apply-button") || byText("button", /^Apply$/i);
    if (!apply && !companySite) return bg("outcome", { outcome: "skipped" });

    const ev = await bg("api", { path: "/api/ext/evaluate", method: "POST",
      body: { platform: "naukri", url: location.href.split("?")[0], ...d } });
    if (ev.decision !== "apply") {
      await log(`Skip: ${d.title} @ ${d.company} — ${ev.reason}`);
      return bg("outcome", { outcome: "skipped" });
    }
    if (!apply && companySite) {
      await bg("api", { path: "/api/ext/result", method: "POST", body: { job_id: ev.job_id, outcome: "needs_you",
        note: "Naukri sends this one to the company's own site.", missing: ["Apply on the company site"] } });
      return bg("outcome", { outcome: "needs_you", jobId: ev.job_id, title: d.title, company: d.company,
        url: location.href, missing: ["Apply on the company site (resume is ready in JobPilot)"] });
    }

    await log(`Applying (${ev.score}): ${d.title} @ ${d.company}`);
    apply.click();
    const res = await afterApply(ev.job_id);
    await bg("api", { path: "/api/ext/result", method: "POST", body: { job_id: ev.job_id, outcome: res.outcome,
      note: res.note, missing: res.missing || [] } });
    await bg("outcome", { outcome: res.outcome, jobId: ev.job_id, title: d.title, company: d.company,
      url: location.href, missing: res.missing, platform: "naukri" });
    await log(`${res.outcome === "submitted" ? "✅ Applied" : "✋ Needs you"}: ${d.title} @ ${d.company}${res.missing?.length ? ` (${res.missing.join("; ")})` : ""}`);
  }

  const success = () => /successfully applied|applied successfully|application (has been )?sent|you have applied/i.test(text(document.body))
    || byText("button, span", /^Applied$/i);

  async function afterApply(jobId) {
    for (let round = 0; round < 15; round++) {
      await pause(1500, 2500);
      if (success()) return { outcome: "submitted", note: "Naukri apply" };
      const drawer = [...document.querySelectorAll("[class*='chatbot_Drawer'], .chatbot_DrawerContentWrapper, [class*='chatbot']")].find(visible);
      if (!drawer) continue;
      // The latest bot message is the current question.
      const msgs = [...drawer.querySelectorAll("[class*='botMsg'], .botMsg, li[class*='bot'] span, [class*='chatbot_ListItem'] span")].filter(visible);
      const q = text(msgs[msgs.length - 1]);
      if (!q) continue;
      const radios = [...drawer.querySelectorAll("input[type='radio']")].filter((r) => visible(r) || visible(r.parentElement));
      const chips = [...drawer.querySelectorAll("[class*='chip'], .chatbot_Chip, [class*='ssrc__radio-btn-container'] label")].filter(visible);
      const checks = [...drawer.querySelectorAll("input[type='checkbox']")];
      const input = drawer.querySelector("[contenteditable='true'], .textArea, input[type='text'], textarea");
      const options = radios.length ? radios.map((r) => text(drawer.querySelector(`label[for="${CSS.escape(r.id)}"]`)) || r.value)
        : chips.map(text);
      const type = options.length ? "radio" : checks.length ? "checkbox" : "text";
      const { answers } = await bg("api", { path: "/api/ext/answers", method: "POST",
        body: { job_id: jobId, fields: [{ key: "q", label: q.slice(0, 1000), type, options, required: true }] } });
      const a = answers.q;
      if (a == null) {
        drawer.querySelector("[class*='crossIcon'], .crossIcon, [aria-label='close']")?.click();
        return { outcome: "needs_you", missing: [q], note: "Naukri questionnaire needs your answer." };
      }
      if (radios.length) {
        const i = options.findIndex((o) => o.toLowerCase() === String(a).toLowerCase());
        (i >= 0 ? radios[i] : radios[0]).click();
      } else if (chips.length) {
        const c = chips.find((x) => text(x).toLowerCase() === String(a).toLowerCase()) || chips[0];
        c.click();
      } else if (input) {
        if (input.isContentEditable) {
          input.focus();
          input.textContent = String(a);
          input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        } else setValue(input, String(a));
      }
      await sleep(700);
      const send = drawer.querySelector(".sendMsg, [class*='sendMsg'], [class*='send']") || byText("div, button", /^Save$/i, drawer);
      send?.click();
    }
    return success() ? { outcome: "submitted", note: "Naukri apply" } : { outcome: "failed", note: "No confirmation from Naukri." };
  }
})();
