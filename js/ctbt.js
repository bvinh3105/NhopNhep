// Game "Cơm Tấm Bà Thảo" (https://com-tam-ba-thao.bachvinhtran.workers.dev/)
// ↔ Nhóp Nhép. Game đăng check-in qua functions/api/game-checkin.js dưới
// tài khoản của chính người chơi (source = 'game', công khai ở trang quán; bài cũ: tài khoản chung "Bà Thảo").
// 2026-10-01 liên kết tài khoản: game mở ?game_link=1&state=…&back=<origin game> → đăng nhập (nếu chưa)
// → bấm "Cho phép" → /api/game-link ký vé → gửi về game (postMessage cho tab đã mở trang này, không có thì
// chuyển về <game>/#nnlink=<vé>). Mở game từ app khi đang đăng nhập thì tự kèm vé (game hỏi lại trước khi nhận).
// Chơi game không cần tài khoản; chỉ đăng lên Nhóp Nhép mới cần.
// File này chỉ lo phần hiển thị phía app:
//   - nhãn 🎮 trên check-in từ game (viewer) → mở game
//   - trang quán "Cơm Tấm Bà Thảo": nút Chơi thử + dải check-in từ game
//   - banner nhỏ ở tab Cộng đồng › Quán ăn
// Mọi link sang game gắn ?from=nhopnhep để game chào + tặng quà người tới từ đây.
const CtbtGame = {
  GAME_URL: 'https://com-tam-ba-thao.bachvinhtran.workers.dev/',
  // địa chỉ game được nhận vé liên kết (github.io cũ giữ phòng khi bật lại)
  GAME_ORIGINS: ['https://com-tam-ba-thao.bachvinhtran.workers.dev', 'https://bvinh3105.github.io'],
  // id quán "Cơm Tấm Bà Thảo" trên PocketBase — điền sau khi tạo quán trên server
  QUAN_ID: 'i99wc0ypelhuxqj',
  STRIP_MAX: 12,
  // Tạm đóng lối vào game (2026-09-29, game đang nâng cấp asset): banner, nút Chơi thử, nhãn 🎮 vẫn hiện,
  // bấm vào chỉ báo "đang cập nhật". Mở lại: đổi thành true.
  PLAY_OPEN: true,

  url(src) {
    const u = new URL(this.GAME_URL);
    u.searchParams.set('from', 'nhopnhep');
    if (src) u.searchParams.set('utm_content', src);
    return u.toString();
  },

  open(src) {
    if (!this.PLAY_OPEN) { showToast(I18N.t('ctbt.updating'), 3000); return; }
    if (typeof Analytics !== 'undefined') Analytics.track('game_open', { src: src || '' });
    const url = this.url(src);
    if (!(typeof Community !== 'undefined' && Community.isLoggedIn())) { window.open(url, '_blank', 'noopener'); return; }
    // Đang đăng nhập: kèm vé liên kết để game tự lưu tiến trình theo tài khoản (game hỏi lại trước khi nhận).
    // Mở tab ngay trong cú bấm (không bị chặn popup), xin vé xong mới điền địa chỉ.
    const win = window.open('about:blank', '_blank');
    this.requestLinkToken().then(r => {
      const target = r.ok ? `${url}#nnlink=${encodeURIComponent(r.token)}` : url;
      if (win) { try { win.opener = null; } catch (_) { /* bỏ qua */ } win.location.href = target; }
      else location.href = target;
    });
  },

  isGameOrigin(o) {
    return this.GAME_ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(o || '');
  },

  async requestLinkToken() {
    try {
      const res = await fetch('/api/game-link', { method: 'POST', headers: { Authorization: Community.token } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.token) return { ok: true, token: data.token, name: data.name };
      return { ok: false, status: res.status, message: data.message || '' };
    } catch (_) {
      return { ok: false, status: 0, message: '' };
    }
  },

  // ---------- LIÊN KẾT TÀI KHOẢN VỚI GAME ----------
  _linkReq: null,
  _linkPoll: null,

  handleLinkRequest() {
    let q;
    try { q = new URLSearchParams(location.search); } catch (_) { return; }
    if (q.get('game_link') !== '1') return;
    const state = q.get('state') || '';
    const back = q.get('back') || '';
    ['game_link', 'state', 'back'].forEach(k => q.delete(k));
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    if (!/^[0-9a-f]{16,64}$/.test(state) || !this.isGameOrigin(back)) return;
    this._linkReq = { state, back };
    if (Community.isLoggedIn()) { this._showLinkSheet(); return; }
    showToast(I18N.t('ctbt.linkNeedLogin'), 4500);
    if (typeof CommunityCtrl !== 'undefined') CommunityCtrl.showAuthPrompt('login');
    this._waitLoginThenAsk();
  },

  // Chưa đăng nhập / phiên hết hạn giữa chừng: đăng nhập xong thì hỏi tiếp
  _waitLoginThenAsk() {
    clearInterval(this._linkPoll);
    this._linkPoll = setInterval(() => {
      if (!this._linkReq) { clearInterval(this._linkPoll); return; }
      if (Community.isLoggedIn()) { clearInterval(this._linkPoll); this._showLinkSheet(); }
    }, 800);
  },

  _showLinkSheet() {
    let ov = document.getElementById('ctbtLinkOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.id = 'ctbtLinkOverlay';
      ov.innerHTML = `
        <div class="modal-sheet ctbt-link-sheet">
          <div class="modal-handle"></div>
          <div class="ctbt-link-ico"><img src="icons/icon_dia_com_tam.png" alt="" width="56" height="56"></div>
          <div class="modal-title">${I18N.t('ctbt.linkTitle')}</div>
          <div class="modal-sub" id="ctbtLinkWho"></div>
          <ul class="ctbt-link-list">
            <li>${I18N.t('ctbt.linkWhy1')}</li>
            <li>${I18N.t('ctbt.linkWhy2')}</li>
            <li>${I18N.t('ctbt.linkWhy3')}</li>
          </ul>
          <button class="ctbt-play" id="ctbtLinkYes" type="button">${I18N.t('ctbt.linkYes')}</button>
          <button class="ctbt-link-no" id="ctbtLinkNo" type="button">${I18N.t('ctbt.linkNo')}</button>
          <div class="ctbt-link-status" id="ctbtLinkStatus"></div>
        </div>`;
      document.body.appendChild(ov);
      ov.querySelector('#ctbtLinkYes').addEventListener('click', () => this._approveLink());
      ov.querySelector('#ctbtLinkNo').addEventListener('click', () => this._denyLink());
    }
    const user = Community.currentUser || {};
    ov.querySelector('#ctbtLinkWho').innerHTML = I18N.t('ctbt.linkSub', { name: escapeHtml(user.name || I18N.t('common.anonymous')) });
    ov.querySelector('#ctbtLinkStatus').textContent = '';
    ov.querySelector('#ctbtLinkYes').disabled = false;
    setTimeout(() => ov.classList.add('show'), 30);   // không dùng rAF: tab mở ở nền không chạy rAF
  },

  _hideLinkSheet() {
    const ov = document.getElementById('ctbtLinkOverlay');
    if (ov) ov.classList.remove('show');
  },

  async _approveLink() {
    if (!this._linkReq) return;
    const ov = document.getElementById('ctbtLinkOverlay');
    const status = ov.querySelector('#ctbtLinkStatus');
    const yes = ov.querySelector('#ctbtLinkYes');
    yes.disabled = true;
    status.textContent = I18N.t('ctbt.linkWorking');
    const r = await this.requestLinkToken();
    if (!r.ok) {
      yes.disabled = false;
      if (r.status === 401) {
        this._hideLinkSheet();
        showToast(I18N.t('ctbt.linkNeedLogin'), 4500);
        if (typeof CommunityCtrl !== 'undefined') CommunityCtrl.showAuthPrompt('login');
        this._waitLoginThenAsk();
      } else {
        status.textContent = r.message || I18N.t('ctbt.linkFail');
      }
      return;
    }
    status.textContent = I18N.t('ctbt.linkDone');
    this._deliverLink({ token: r.token, name: r.name });
  },

  _denyLink() {
    this._hideLinkSheet();
    this._deliverLink({ error: 'denied' });
  },

  // Gửi kết quả về game: tab game đã mở trang này thì postMessage rồi đóng tab; không thì chuyển hẳn về game
  _deliverLink(payload) {
    const req = this._linkReq;
    this._linkReq = null;
    if (!req) return;
    const msg = Object.assign({ type: 'nn-game-link', state: req.state }, payload);
    let delivered = false;
    try {
      if (window.opener && !window.opener.closed) { window.opener.postMessage(msg, req.back); delivered = true; }
    } catch (_) { /* tab game đã đóng */ }
    if (delivered) {
      setTimeout(() => { try { window.close(); } catch (_) { /* bỏ qua */ } }, 900);
      setTimeout(() => this._hideLinkSheet(), 1200);
      return;
    }
    if (payload.error) return;
    const frag = `nnlink=${encodeURIComponent(payload.token)}&state=${req.state}`;
    setTimeout(() => { location.href = `${req.back}/#${frag}`; }, 600);
  },

  isGameCheckin(rec) {
    return !!rec && rec.source === 'game';
  },

  isGameQuan(r) {
    if (!r || !this.QUAN_ID) return false;
    if (r.id === this.QUAN_ID) return true;
    return typeof Community !== 'undefined' && Community.resolveRootId && Community.resolveRootId(r) === this.QUAN_ID;
  },

  init() {
    this.handleLinkRequest();
    const banner = document.getElementById('ctbtBanner');
    if (banner) {
      banner.classList.remove('hidden');
      document.getElementById('ctbtBannerBtn').addEventListener('click', () => this.open('banner'));
    }
  },

  // Viewer: nhãn 🎮 dưới caption (gọi từ CheckinViewerCtrl._renderPost)
  renderViewerBadge(rec) {
    const el = document.getElementById('ciViewerGame');
    if (!el) return;
    const on = this.isGameCheckin(rec);
    el.classList.toggle('hidden', !on);
    if (on && !el.dataset.wired) {
      el.dataset.wired = '1';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof CheckinViewerCtrl !== 'undefined' && CheckinViewerCtrl._pauseAutoTimer) CheckinViewerCtrl._pauseAutoTimer();
        this.open('checkin');
      });
    }
  },

  // Trang quán: HTML chèn sau địa chỉ (gọi trong CommunityDetailModal.open)
  quanHtml(r) {
    if (!this.isGameQuan(r)) return '';
    return `
      <div class="ctbt-quan">
        <button class="ctbt-play" id="ctbtPlayBtn" type="button">🎮 ${I18N.t('ctbt.play')}</button>
        <div class="ctbt-strip-title">${I18N.t('ctbt.stripTitle')}</div>
        <div class="ctbt-strip" id="ctbtStrip"><div class="ctbt-strip-empty">${I18N.t('ctbt.stripLoading')}</div></div>
      </div>`;
  },

  async wireQuan(r, body) {
    if (!this.isGameQuan(r)) return;
    const btn = body.querySelector('#ctbtPlayBtn');
    if (btn) btn.addEventListener('click', () => this.open('quan'));
    const strip = body.querySelector('#ctbtStrip');
    if (!strip) return;
    const res = await Community.getCheckinsForRestaurant(this.QUAN_ID, { perPage: this.STRIP_MAX });
    if (!strip.isConnected) return;
    const items = res.ok ? (res.data.items || []).filter(x => this.isGameCheckin(x) && x.photo) : [];
    if (!items.length) {
      strip.innerHTML = `<div class="ctbt-strip-empty">${I18N.t('ctbt.stripEmpty')}</div>`;
      return;
    }
    strip.innerHTML = items.map((rec, i) => `
      <button class="ctbt-thumb" type="button" data-i="${i}" title="${escapeHtml(rec.note || '')}"
        style="background-image:url('${escapeHtml(Community.checkinPhotoUrl(rec, '160x160'))}')"></button>`).join('');
    strip.querySelectorAll('.ctbt-thumb').forEach(el => {
      el.addEventListener('click', () => {
        const i = +el.dataset.i;
        const group = { user: items[0].expand && items[0].expand.user, items: items.slice(i).concat(items.slice(0, i)), hasFresh: false };
        if (typeof CheckinViewerCtrl !== 'undefined') CheckinViewerCtrl.open([group], 0, { src: 'quan' });
      });
    });
  },
};
