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

  // A window-size-delta DevTools shield used to live here. Removed: on
  // real phones (this app's actual target — it's a PWA) mobile browser
  // chrome (URL bar collapse/expand, notch/nav-bar reporting) routinely
  // pushes outerWidth/outerHeight away from innerWidth/innerHeight by
  // more than the threshold, and it stayed wrong for the whole session,
  // not just a one-tick reflow — so it locked out real users on real
  // devices, not just snoops. The keyboard/right-click blocks above are
  // enough of a deterrent and don't have that failure mode.
})();
