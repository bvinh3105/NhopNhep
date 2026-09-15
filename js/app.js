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
  I18N.init(); // trước tiên — mọi chữ tĩnh trong HTML phải đúng ngôn ngữ ngay từ lần vẽ đầu
  Storage.load();
  DropdownPosition.init();
  TabNav.init();
  MapHome.init();
  HomeCtrl.init();
  ResultsCtrl.init();
  PlanCtrl.init();
  ProfileCtrl.init();
  DetailModal.init();
  HistoryModal.init();
  CommunityCtrl.init();
  CommunityAddModal.init();
  PhotoView.init();
  SavedTripsModal.init();
  CommunityDetailModal.init();
  UserQuanModal.init();
  SavedListModal.init();
  FollowerListModal.init();
  FollowingListModal.init();
  FriendsListModal.init();
  wireScrollMasks();

  // Deep-link handler: ?q=<pb_id> auto-opens the community detail
  // modal for that quán. Used by the "Sao chép link" button in the
  // detail modal so shared links land on the right screen.
  const urlQ = new URLSearchParams(location.search).get('q');
  if (urlQ) {
    // Delay slightly so all controllers/modals are ready to render.
    setTimeout(() => SavedListModal.openFromLink(urlQ), 400);
  }

  // Referral link: ?ref=<inviter_user_id> from "Mời bạn bè". Stashed in
  // sessionStorage (not localStorage) — attribution should only apply to
  // THIS visit deciding to register, not linger indefinitely and wrongly
  // credit an unrelated signup weeks later from the same browser. Read by
  // _submitAuth() in controllers.js when the register form is submitted;
  // functions/api/register.js validates it's a real user before attaching.
  const urlRef = new URLSearchParams(location.search).get('ref');
  if (urlRef) {
    try { sessionStorage.setItem('nhopnhep_ref', urlRef); } catch (_) {}
  }

  // Fire-and-forget one app_open event per page load. Skipped on
  // localhost by Analytics itself so dev noise doesn't hit prod stats.
  if (typeof Analytics !== 'undefined') Analytics.boot();

  // Community._fetch() fires this on any 401 (expired/revoked token) so
  // whichever screen is open re-renders immediately instead of silently
  // keeping stale "logged in" UI until the user happens to switch tabs.
  document.addEventListener('community:session-expired', () => {
    showToast(I18N.t('app.sessionExpired'));
    ProfileCtrl.render();
    CommunityCtrl.render();
  });

  // Đổi ngôn ngữ xong: I18N.apply() đã tự sửa lại mọi [data-i18n] tĩnh,
  // nhưng phần nội dung ĐỘNG (đã render sẵn = còn chữ ngôn ngữ cũ) ở
  // những màn hay đang mở cần vẽ lại bằng tay.
  document.addEventListener('i18n:changed', () => {
    ProfileCtrl.render();
    CommunityCtrl.render();
    if (State.filteredResults?.length) { ResultsCtrl._updateHeader(); ResultsCtrl._applyFilters(); }
    ResultsCtrl._updatePlanBtn();
  });

  // Fallback default location — Hoàn Kiếm, Hà Nội
  State.userLat = 21.0285;
  State.userLng = 105.8542;
  document.getElementById('locInput').value = I18N.t('app.sampleLocation');
  MapHome.setUserLocation(State.userLat, State.userLng, null, { center:true });

  // Silent GPS attempt if the context is secure
  GPS.silentFix();

  // Warn if not secure context
  if (!GPS.isSecure() && location.protocol === 'http:' && location.hostname !== 'localhost') {
    setTimeout(() => {
      GPS.hint(I18N.t('app.httpsHint'), 'warn');
    }, 800);
  }
}

/* ═══════════════════════════════════════════════
   CRASH REPORTER
   Captures unhandled JS errors and Promise
   rejections on the user's device, then forwards
   them to /api/error-report so they show up in
   Cloudflare Workers Real-time Logs (filter "[crash]")
   and PocketBase error_logs (best-effort).
   Hard-capped at 5 reports per session — never floods.
═══════════════════════════════════════════════ */
(function initCrashReporter() {
  const ENDPOINT = '/api/error-report';
  // Version tag — update this when bumping v= in index.html so error
  // reports can be correlated with the exact deployed build.
  const VER = 'v2526';
  let _n = 0; // per-session counter

  function send(payload) {
    if (_n >= 5) return; // 5-per-session cap
    _n++;
    const body = JSON.stringify({ ...payload, ver: VER, href: location.pathname });
    try {
      if (navigator.sendBeacon) {
        // sendBeacon survives page unload — best for crash-during-navigation.
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, {
          method: 'POST', body,
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
        }).catch(() => {});
      }
    } catch (_) { /* crash reporter must never itself throw */ }
  }

  window.addEventListener('error', (e) => {
    send({
      kind: 'js_error',
      msg:  (e.message  || 'unknown').slice(0, 200),
      src:  (e.filename || '').replace(location.origin, '').slice(0, 100),
      line: e.lineno,
      col:  e.colno,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    send({
      kind: 'promise_rejection',
      msg:  (r?.message || String(r) || 'unhandled rejection').slice(0, 200),
    });
  });
})();

document.addEventListener('DOMContentLoaded', boot);
