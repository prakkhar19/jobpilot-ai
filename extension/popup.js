const $ = (id) => document.getElementById(id);
const send = (type, payload = {}) => new Promise((res, rej) =>
  chrome.runtime.sendMessage({ type, ...payload }, (r) => (r && r.error ? rej(new Error(r.error)) : res(r))));

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let firstRender = true;
let lastNeeds = "";
async function render() {
  const s = await send("state");
  const loggedIn = !!s.token;
  $("login").hidden = loggedIn;
  $("main").hidden = !loggedIn;
  $("acct").textContent = loggedIn ? s.account || "" : "";
  $("server").value = s.server;
  if (!loggedIn) return;

  $("dot").classList.toggle("on", s.running);
  $("toggle").textContent = s.running ? "Stop" : "Start auto-apply";
  $("toggle").className = s.running ? "stop" : "primary";
  const step = s.steps[s.stepIndex];
  $("current").textContent = s.running ? (step ? `Step ${s.stepIndex + 1}/${s.steps.length}: ${step.label}` : "Waiting for the next cycle…") : "";

  $("sApplied").textContent = s.stats.applied;
  $("sNeeds").textContent = s.stats.needsYou;
  $("sOut").textContent = s.stats.outreach;
  $("sSkip").textContent = s.stats.skipped;

  const st = s.settings;
  if (firstRender) {
  firstRender = false;
  $("pLinkedin").checked = st.platforms.linkedin;
  $("pNaukri").checked = st.platforms.naukri;
  $("pInstahyre").checked = st.platforms.instahyre;
  $("pCompany").checked = st.platforms.company;
  $("outreach").checked = st.outreach;
  $("dailyCap").value = st.dailyCap;
  $("outreachCap").value = st.outreachCap;
  $("perCompany").value = st.perCompany;
  $("pages").value = st.pagesPerSearch;
  $("cycle").value = st.cycleMinutes;
  }

  $("nyCount").textContent = s.needsYou.length;
  const sig = JSON.stringify(s.needsYou.map((n) => n.jobId));
  const typing = [...document.querySelectorAll("#needs input")].some((i) => i.value);
  if (sig !== lastNeeds && !typing) {
  lastNeeds = sig;
  $("needs").innerHTML = s.needsYou.slice(0, 25).map((n, i) => `
    <div class="ny" data-i="${i}">
      <a href="${esc(n.url)}" target="_blank">${esc(n.title)} — ${esc(n.company)}</a>
      ${(n.missing || []).map((q) => /CAPTCHA|company site|sign in|Submit button|confirm/i.test(q)
        ? `<div class="q">${esc(q)}</div>`
        : `<div class="q">${esc(q)}</div><input type="text" data-q="${esc(q)}" placeholder="Your answer (saved for next time)">`).join("")}
      <div class="row"><button class="small" data-act="save" data-job="${esc(n.jobId)}">Save answers</button>
      <button class="small" data-act="dismiss" data-job="${esc(n.jobId)}">Done / dismiss</button></div>
    </div>`).join("") || `<p class="muted">Nothing — all good.</p>`;
  }

  $("log").textContent = (s.log || []).slice(0, 120).join("\n");
}

$("loginBtn").onclick = async () => {
  $("loginErr").textContent = "";
  try {
    await send("login", { server: $("server").value.trim() || "http://localhost:8080", email: $("email").value.trim(), password: $("password").value });
    $("password").value = "";
    render();
  } catch (e) { $("loginErr").textContent = e.message; }
};

$("toggle").onclick = async () => {
  const s = await send("state");
  await send(s.running ? "stop" : "start");
  render();
};

$("save").onclick = async () => {
  const n = (id, d) => Math.max(0, parseInt($(id).value, 10) || d);
  await send("saveSettings", { settings: {
    dailyCap: n("dailyCap", 150), outreachCap: n("outreachCap", 15), perCompany: n("perCompany", 2),
    pagesPerSearch: Math.max(1, n("pages", 2)), cycleMinutes: Math.max(15, n("cycle", 60)), outreach: $("outreach").checked,
    platforms: { linkedin: $("pLinkedin").checked, naukri: $("pNaukri").checked, instahyre: $("pInstahyre").checked, company: $("pCompany").checked },
  } });
  render();
};

$("logout").onclick = async () => { await send("logout"); render(); };

$("needs").onclick = async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const card = b.closest(".ny");
  if (b.dataset.act === "save") {
    const answers = {};
    card.querySelectorAll("input[data-q]").forEach((i) => { if (i.value.trim()) answers[i.dataset.q] = i.value.trim(); });
    try { await send("answerNeedsYou", { jobId: b.dataset.job, answers }); } catch (err) { alert(err.message); }
  } else {
    await send("dismissNeedsYou", { jobId: b.dataset.job });
  }
  card.querySelectorAll("input").forEach((i) => { i.value = ""; });
  lastNeeds = "";
  render();
};

render();
setInterval(render, 2500);
