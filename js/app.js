/* ═══════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════ */
// Delegated scroll listener — any element that opts into ".scroll-mask"
// (or one of the pre-tagged classes below) gets an .at-end toggle so
// the CSS right-edge fade disappears once the user is at the last chip.
function wireScrollMasks() {
  const selectors = '.cat-chips, .cat-tabs, .plan-summary';
  const update = (el) => {
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    el.classList.toggle('at-end', atEnd);
    // If content fits without scrolling, no fade needed either.
    if (el.scrollWidth <= el.clientWidth + 1) el.classList.add('at-end');
  };
  const bind = (el) => {
    if (el._scrollMaskBound) return;
    el._scrollMaskBound = true;
    el.addEventListener('scroll', () => update(el), { passive: true });
    update(el);
  };
  document.querySelectorAll(selectors).forEach(bind);
  // Rebind after any DOM mutation that swaps chip lists (results grid,
  // plan summary, etc.). One shared observer keeps it cheap.
  const mo = new MutationObserver(() => {
    document.querySelectorAll(selectors).forEach(bind);
    document.querySelectorAll(selectors).forEach(update);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => {
    document.querySelectorAll(selectors).forEach(update);
  }, { passive: true });
}

function boot() {
  Storage.load();
  TabNav.init();
  MapHome.init();
  HomeCtrl.init();
  ResultsCtrl.init();
  PlanCtrl.init();
  ProfileCtrl.init();
  AddModal.init();
  DetailModal.init();
  HistoryModal.init();
  CommunityCtrl.init();
  CommunityAddModal.init();
  wireScrollMasks();

  // Fallback default location — Hoàn Kiếm, Hà Nội
  State.userLat = 21.0285;
  State.userLng = 105.8542;
  document.getElementById('locInput').value = '📌 Hoàn Kiếm, Hà Nội (mẫu)';
  MapHome.setUserLocation(State.userLat, State.userLng, null, { center:true });

  // Silent GPS attempt if the context is secure
  GPS.silentFix();

  // Warn if not secure context
  if (!GPS.isSecure() && location.protocol === 'http:' && location.hostname !== 'localhost') {
    setTimeout(() => {
      GPS.hint('⚠️ GPS chỉ chạy qua HTTPS. Deploy Netlify hoặc dùng localhost để test', 'warn');
    }, 800);
  }
}

document.addEventListener('DOMContentLoaded', boot);
