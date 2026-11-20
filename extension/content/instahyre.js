// Instahyre: go through the "matching opportunities" list, open each, evaluate, and click Apply.
(async () => {
  const { sleep, pause, waitFor, text, visible, byText, bg, log } = window.JP;
  if (window.__jpInstahyre) return;
  window.__jpInstahyre = true;

  await sleep(3000);
  let ctx;
  try { ctx = await bg("getTask"); } catch (_) { return; }
  if (!ctx || !ctx.task || ctx.task.kind !== "instahyre") return;

  if (/login/.test(location.pathname)) {
    await log("Instahyre needs you to log in. Log in in this Chrome, then press Start again.");
    return bg("stepDone", { keepTab: true });
  }
  try { await run(ctx); } catch (e) { await log(`Error: ${e.message}`); }
  bg("stepDone", {});

  async function run({ remaining }) {
    await waitFor(() => byText("button, a", /^View$/i), 15000);
    let left = remaining;
    const seen = new Set();
    for (let i = 0; i < 40 && left > 0; i++) {
      const view = [...document.querySelectorAll("button, a")].find((b) => visible(b) && /^View$/i.test(text(b)) && !seen.has(b));
      if (!view) break;
      seen.add(view);
      const card = view.closest("[class*='employer'], [class*='opportunit'], .row, li, div");
      view.click();
      const modal = await waitFor(() => [...document.querySelectorAll(".modal, [role='dialog'], [class*='job-detail'], [class*='modal']")].find(visible), 8000);
      if (!modal) continue;
      await pause(1000, 2000);
      const title = text(modal.querySelector("h1, h2, .job-title, [class*='designation'], [class*='title']"));
      const company = text(modal.querySelector(".company-name, [class*='company']")) || text(card?.querySelector("[class*='company']"));
      const loc = text(modal.querySelector("[class*='location']"));
      const description = text(modal).slice(0, 20000);
      const apply = byText("button, a", /^(Apply|I'm interested|Interested)$/i, modal);
      const close = () => (modal.querySelector(".close, [aria-label='Close'], [class*='close']") || byText("button", /^(Close|Not interested|Skip)$/i, modal))?.click();
      if (!title || !company || !apply) { close(); continue; }
      const ev = await bg("api", { path: "/api/ext/evaluate", method: "POST", body: { platform: "instahyre",
        url: `https://www.instahyre.com/job/${encodeURIComponent(company)}/${encodeURIComponent(title)}`, title, company,
        location: loc, description, workplace_type: /remote/i.test(loc) ? "remote" : "unknown" } });
      if (ev.decision !== "apply") {
        await log(`Skip: ${title} @ ${company} — ${ev.reason}`);
        await bg("outcome", { outcome: "skipped" });
        close();
        await sleep(800);
        continue;
      }
      apply.click();
      await sleep(2500);
      const confirm = byText("button", /^(Apply|Confirm|Yes)$/i);
      if (confirm) { confirm.click(); await sleep(2000); }
      const ok = /applied|application sent|success/i.test(text(document.body));
      const outcome = ok ? "submitted" : "failed";
      await bg("api", { path: "/api/ext/result", method: "POST", body: { job_id: ev.job_id, outcome, note: "Instahyre apply" } });
      const r = await bg("outcome", { outcome, jobId: ev.job_id, title, company, url: location.href, platform: "instahyre" });
      await log(`${ok ? "✅ Applied" : "⚠️ Not confirmed"}: ${title} @ ${company}`);
      left = r.remaining;
      close();
      await pause(2000, 4000);
    }
  }
})();
