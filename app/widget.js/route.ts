export const dynamic = "force-static";

/**
 * Skrip widget: <script src="https://<app>/widget.js" data-bot="<slug>" async></script>
 * Memunculkan tombol chat di pojok dan jendela chat (iframe ke /embed/<slug>).
 * Tampilan (warna, posisi, teks) diambil dari pengaturan bot di tab Publikasi.
 */
const SCRIPT = String.raw`(function () {
  var s = document.currentScript;
  if (!s || window.__botCreatorWidget) return;
  var slug = (s.getAttribute("data-bot") || "").toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return;
  window.__botCreatorWidget = true;
  var origin = new URL(s.src).origin;

  fetch(origin + "/api/public/" + slug + "/widget").then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
    if (!cfg) return;
    var color = /^#[0-9a-fA-F]{6}$/.test(cfg.color) ? cfg.color : "#4f46e5";
    var side = cfg.position === "left" ? "left" : "right";
    var root = document.createElement("div");
    root.setAttribute("data-bot-creator", slug);
    root.style.cssText = "position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000;font-family:system-ui,sans-serif;";

    var frame = document.createElement("iframe");
    frame.title = "Chat " + (cfg.name || "");
    frame.src = origin + "/embed/" + slug;
    frame.allow = "clipboard-write";
    frame.style.cssText = "display:none;position:fixed;bottom:88px;" + side + ":20px;width:380px;height:600px;max-height:calc(100vh - 108px);border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);background:#fff;";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", "Buka chat " + (cfg.name || ""));
    btn.setAttribute("aria-expanded", "false");
    btn.style.cssText = "display:flex;align-items:center;gap:8px;min-height:52px;padding:0 20px;border:0;border-radius:999px;cursor:pointer;color:#fff;font-size:15px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.2);background:" + color + ";";
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    var label = document.createElement("span");
    label.textContent = cfg.buttonText || "Chat";
    btn.appendChild(label);

    function layout() {
      var small = window.innerWidth < 480;
      if (small) frame.style.cssText += "width:100vw;height:100dvh;max-height:none;bottom:0;" + side + ":0;border-radius:0;";
    }
    function setOpen(open) {
      frame.style.display = open ? "block" : "none";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) layout();
      if (window.innerWidth < 480) btn.style.display = open ? "none" : "flex";
    }
    btn.addEventListener("click", function () { setOpen(frame.style.display === "none"); });
    window.addEventListener("message", function (e) {
      if (e.origin === origin && e.data && e.data.type === "bot-creator:close") setOpen(false);
    });
    root.appendChild(frame);
    root.appendChild(btn);
    document.body.appendChild(root);
  }).catch(function () {});
})();`;

export function GET() {
  return new Response(SCRIPT, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
