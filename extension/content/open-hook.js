// Runs in the page itself (world: MAIN) at document_start on job boards. Only in the extension's worker tab — marked
// with sessionStorage.jpHook just before it clicks "Apply on company site" — it records the employer URL the site
// tries to open (window.open / target=_blank), because Chrome blocks that pop-up for a scripted click.
(() => {
  let on = false;
  try { on = sessionStorage.getItem("jpHook") === "1"; } catch (_) { return; }
  if (!on || window.__jpOpenHooked) return;
  window.__jpOpenHooked = true;
  const record = (u) => {
    try {
      const url = new URL(String(u), location.href).href;
      if (!/^https?:/.test(url) || /(^|\.)(naukri|linkedin|ambitionbox)\.com$/.test(new URL(url).hostname)) return;
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
    const a = e.target && e.target.closest && e.target.closest("a[target='_blank'][href]");
    if (a) record(a.href);
  }, true);
})();
