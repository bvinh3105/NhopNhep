/* ═══════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════ */
// Delegated scroll listener — any element that opts into ".scroll-mask"
// (or one of the pre-tagged classes below) gets an .at-end toggle so
// the CSS right-edge fade disappears once the user is at the last chip.
function wireScrollMasks() {
  const selectors = '.cat-chips, .cat-tabs, .plan-summary';
  // "At the end" = the last item's right edge (plus its 2px sticker
  // shadow) is inside the box. scrollWidth alone counted the row's right
  // PADDING (2.2rem on .cat-chips) as overflow, so a row that fitted still
  // faded its last chip out — the "Cộng đồng" chip looked cut off.
  const update = (el) => {
    const last = el.lastElementChild;
    const atEnd = !last || last.getBoundingClientRect().right + 2 <= el.getBoundingClientRect().right + 1;
    el.classList.toggle('at-end', atEnd);
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

// Banner "Mở bằng Safari/Chrome": gần như mọi lượt vào tới từ link trong
// Threads, mà trình duyệt nhúng của app không cài PWA được, hay văng đăng
// nhập và chặn/khó cấp GPS. Chỉ hiện trong webview của app; tắt thì thôi
// cả phiên. Android + app Meta nhận link intent:// để bật thẳng Chrome;
// còn lại (iOS không có cách mở Safari từ webview) thì chép link để dán.
const InAppBanner = {
  KEY: 'nn_iab_dismissed',
  APPS: [
    [/Barcelona/i, 'Threads'],
    [/Instagram/i, 'Instagram'],
    [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
    [/Zalo/i, 'Zalo'],
    [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
    [/\bLine\//i, 'LINE'],
  ],
  INTENT_APPS: ['Threads', 'Instagram', 'Facebook'],
  _app: null,
  _android: false,

  // Tên app, 'webview' nếu là webview lạ, null nếu là trình duyệt thật.
  detect() {
    const ua = navigator.userAgent || '';
    for (const [re, name] of this.APPS) if (re.test(ua)) return name;
    if (navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches) return null;
    if (/Android/.test(ua) && /; wv\)/.test(ua)) return 'webview';
    if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua)) return 'webview';
    return null;
  },

  init() {
    const app = this.detect();
    if (!app) return;
    try { if (sessionStorage.getItem(this.KEY)) return; } catch (_) {}
    this._app = app;
    this._android = /Android/.test(navigator.userAgent || '');
    this.render();
    document.getElementById('iabBanner').classList.remove('hidden');
    document.documentElement.classList.add('iab-on');
    document.getElementById('iabOpen').addEventListener('click', () => this.open());
    document.getElementById('iabClose').addEventListener('click', () => this.dismiss());
    document.addEventListener('i18n:changed', () => this.render());
    if (typeof Analytics !== 'undefined') Analytics.track('iab_banner', { app });
  },

  _browser() { return this._android ? 'Chrome' : 'Safari'; },
  _canIntent() { return this._android && this.INTENT_APPS.includes(this._app); },

  render() {
    const browser = this._browser();
    document.getElementById('iabText').textContent = this._app === 'webview'
      ? I18N.t('iab.textGeneric', { browser })
      : I18N.t('iab.text', { app: this._app, browser });
    document.getElementById('iabOpen').textContent = this._canIntent()
      ? I18N.t('iab.open', { browser }) : I18N.t('iab.copy');
  },

  open() {
    const intent = this._canIntent();
    if (typeof Analytics !== 'undefined') Analytics.track('iab_open', { app: this._app, how: intent ? 'intent' : 'copy' });
    if (!intent) { this._copy(); return; }
    location.href = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;end`;
    // App không chịu mở Chrome → trang vẫn đang hiện: chép link để tự dán.
    setTimeout(() => { if (document.visibilityState === 'visible') this._copy(); }, 1500);
  },

  async _copy() {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove();
      if (!ok) { showToast(I18N.t('toast.linkCopyFail')); return; }
    }
    showToast(I18N.t('iab.copied', { browser: this._browser() }), 5000);
  },

  dismiss() {
    try { sessionStorage.setItem(this.KEY, '1'); } catch (_) {}
    document.getElementById('iabBanner').classList.add('hidden');
    document.documentElement.classList.remove('iab-on');
    setTimeout(() => State.mainMap?.invalidateSize(), 60);
  },
};

function boot() {
  I18N.init(); // trước tiên — mọi chữ tĩnh trong HTML phải đúng ngôn ngữ ngay từ lần vẽ đầu
  InAppBanner.init(); // sớm: đổi --ribbon-h trước khi các màn/bản đồ đo kích thước
  Storage.load();
  DropdownPosition.init();
  TabNav.init();
  MapHome.init();
  HomeCtrl.init();
  ResultsCtrl.init();
  PlanCtrl.init();
  ProfileCtrl.init();
  AvatarCtrl.init();
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
  SessionCreateModal.init();
  SessionVoteModal.init();
  CheckinCtrl.init();
  CheckinFeedCtrl.init();
  CheckinViewerCtrl.init();
  CtbtGame.init();
  NhatKyCtrl.init();
  CheckinDiscoverCtrl.init();
  DmCtrl.init();
  wireScrollMasks();

  // Deep-link handler: ?q=<pb_id> auto-opens the community detail
  // modal for that quán. Used by the "Sao chép link" button in the
  // detail modal so shared links land on the right screen.
  // ?checkin=<id> (the check-in viewer's "Chia sẻ") opens that check-in
  // in the viewer. Once handled, the param is dropped from the address
  // bar (history.replaceState, other params and history state kept) so a
  // reload doesn't re-open the post and count the link view again — but
  // only once it's done with: after a network error the link stays, so a
  // reload can retry.
  const dropUrlParam = (name) => {
    try {
      const u = new URL(location.href);
      u.searchParams.delete(name);
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (_) {}
  };
  const urlQ = new URLSearchParams(location.search).get('q');
  if (urlQ) {
    // Delay slightly so all controllers/modals are ready to render.
    setTimeout(async () => { if (await SavedListModal.openFromLink(urlQ)) dropUrlParam('q'); }, 400);
  }
  const urlCheckin = new URLSearchParams(location.search).get('checkin');
  if (urlCheckin) {
    setTimeout(async () => { if (await CheckinViewerCtrl.openFromLink(urlCheckin)) dropUrlParam('checkin'); }, 400);
  }

  // Group Session invite: ?join=<session_id> from "Sao chép link mời".
  // Mirrors the ?q= handler exactly — dining_sessions.viewRule is fully
  // public, so this works for guest/logged-out/logged-in alike, with no
  // signup wall (see js/community.js Group Session section).
  const urlJoin = new URLSearchParams(location.search).get('join');
  if (urlJoin) {
    setTimeout(() => SessionVoteModal.openFromInvite(urlJoin), 400);
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

  // Resume a guest check-in draft: already logged in (from a previous
  // visit) and a draft is still sitting there — closed the app mid-signup,
  // came back later. The freshly-logged-in-just-now case is handled by
  // CommunityCtrl._submitAuth() instead. Same 400ms delay as the deep-link
  // handlers above, for the same reason (let every controller finish init).
  if (Community.isLoggedIn() && CheckinCtrl._hasPendingDraft()) {
    setTimeout(() => CheckinCtrl._rehydrateDraft(), 400);
  }

  // Warm the local (guest, no-account) diary's photo URLs early, so
  // they're usually already resolved by the time someone opens Sổ Dán
  // Món — NhatKyCtrl.open() also kicks this off itself as a fallback.
  if (typeof LocalDiary !== 'undefined') LocalDiary.preload();

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

  // Thứ tự đặt vị trí ban đầu, từ chính xác nhất xuống fallback:
  //   1) localStorage cache (GPS/user_pick lần trước, TTL 7 ngày) → 0ms
  //   2) Nếu không có cache → Hoàn Kiếm HN tạm để map không trống
  //   3) Song song: GPS.silentFix() — thắng mọi thứ nếu user đã cấp quyền
  //   4) Song song: /api/geo (Cloudflare IP geo, city-accurate) — chỉ
  //      override khi lúc về vẫn là HN default (cache/GPS đã có thì tôn
  //      trọng vì chính xác hơn IP geo).
  // State._locKind theo dõi vị trí đến từ đâu để race không đảo ngược.
  State._locKind = 'hn_default';
  const _locInputEl = document.getElementById('locInput');
  const _cached = LocationCache.load();
  if (_cached) {
    State.userLat = _cached.lat;
    State.userLng = _cached.lng;
    State._locKind = 'cache';
    _locInputEl.value = _cached.label
      ? `📍 ${_cached.label}` : I18N.t('gps.yourLocation');
  } else {
    State.userLat = 21.0285;
    State.userLng = 105.8542;
    _locInputEl.value = I18N.t('app.sampleLocation');
  }
  MapHome.setUserLocation(State.userLat, State.userLng, null, { center: true });

  // Silent GPS attempt if the context is secure
  GPS.silentFix();

  // Cloudflare IP geo — city-accurate, không cần permission. Chỉ áp
  // dụng khi tại thời điểm về vẫn là HN default (cache/GPS/user_pick
  // đều chính xác hơn IP geo). 5s timeout để mạng chậm không kẹt.
  (function fetchCfGeo() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    fetch('/api/geo', { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(g => {
        clearTimeout(timer);
        if (!g || typeof g.lat !== 'number' || typeof g.lng !== 'number') return;
        if (State._locKind !== 'hn_default') return;
        State._locKind = 'cf_geo';
        State.userLat = g.lat; State.userLng = g.lng;
        MapHome.setUserLocation(g.lat, g.lng, null, { center: true });
        if (_locInputEl && _locInputEl.value === I18N.t('app.sampleLocation')) {
          // Suffix "(ước tính)" so user knows this is IP-level (city
          // centroid), not their real spot — feedback 2026-09-16: user
          // in Tây Hồ saw label "📍 Hà Nội" and thought app was locked
          // to Hoàn Kiếm. Making it explicit + nudging to GPS below.
          _locInputEl.value = g.city
            ? `📍 ${g.city} ${I18N.t('gps.approxSuffix')}`
            : I18N.t('gps.yourLocation');
        }
        // CF IP geo lands at city centroid — for a HN IP that's ≈ Hoàn
        // Kiếm, so a user in Tây Hồ/Cầu Giấy/etc sees the map "wrong".
        // Nudge them to enable GPS. GPS.hint auto-clears when GPS starts
        // (startTracking overwrites it), so this only shows while CF geo
        // remains the source of truth.
        if (typeof GPS !== 'undefined' && GPS.hint) {
          GPS.hint(I18N.t('gps.cfGeoHint'), 'warn');
        }
      })
      .catch(() => { clearTimeout(timer); /* offline / abort — bỏ qua */ });
  })();

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
