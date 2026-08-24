/* ═══════════════════════════════════════════════
   CLIENT-SIDE DETERRENT — turns away casual snoops.
   Determined users bypass this in seconds (view-source:,
   Chrome menu, curl, Firefox, opening DevTools BEFORE the
   page loads). Real secrets must live on the server, not
   in this file.
═══════════════════════════════════════════════ */
(function () {
  // Keep localhost fully open — developers need DevTools.
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocal) return;

  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); return false; };

  // Block right-click
  document.addEventListener('contextmenu', swallow);

  // Block "view source" / "save" / "devtools" keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const k = (e.key || '').toUpperCase();
    // F12
    if (e.key === 'F12') return swallow(e);
    // Ctrl+U (view source), Ctrl+S (save page), Ctrl+P (print)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && ['U', 'S', 'P'].includes(k)) return swallow(e);
    // Ctrl+Shift+I / J / C (devtools panels)
    if (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(k)) return swallow(e);
    // Cmd+Option+I / J on macOS
    if (e.metaKey && e.altKey && ['I', 'J'].includes(k)) return swallow(e);
  }, { capture: true });

  // Detect DevTools open via window-size delta. Not perfect
  // (fails for undocked DevTools windows), but catches the
  // usual F12 side-panel.
  const OVERLAY_ID = 'nn-devtools-shield';
  let shieldEl = null;
  const showShield = () => {
    if (shieldEl) return;
    shieldEl = document.createElement('div');
    shieldEl.id = OVERLAY_ID;
    shieldEl.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:rgba(20,10,5,.96)', 'color:#FBF3D9',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'padding:2rem', 'text-align:center',
      'font-family:system-ui,sans-serif',
    ].join(';'));
    shieldEl.innerHTML = `
      <div style="font-size:3rem;margin-bottom:.6rem">🔒</div>
      <div style="font-size:1.3rem;font-weight:800;margin-bottom:.5rem">Đóng DevTools để tiếp tục</div>
      <div style="font-size:.9rem;opacity:.8;max-width:28rem;line-height:1.4">
        App tạm khoá khi phát hiện công cụ debug đang mở. Đóng DevTools
        (F12 hoặc nhấn <b>Esc</b> trong panel) rồi thao tác lại.
      </div>`;
    document.body.appendChild(shieldEl);
  };
  const hideShield = () => {
    if (!shieldEl) return;
    shieldEl.remove();
    shieldEl = null;
  };

  const THRESHOLD = 170;
  setInterval(() => {
    const opened =
      window.outerWidth - window.innerWidth > THRESHOLD ||
      window.outerHeight - window.innerHeight > THRESHOLD;
    if (opened) showShield();
    else hideShield();
  }, 800);
})();
