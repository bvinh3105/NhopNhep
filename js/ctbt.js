// Game "Cơm Tấm Bà Thảo" (https://bvinh3105.github.io/com-tam-ba-thao/)
// ↔ Nhóp Nhép. Game đăng check-in qua functions/api/game-checkin.js dưới
// tài khoản chung "Bà Thảo" (source = 'game', công khai ở trang quán).
// File này chỉ lo phần hiển thị phía app:
//   - nhãn 🎮 trên check-in từ game (viewer) → mở game
//   - trang quán "Cơm Tấm Bà Thảo": nút Chơi thử + dải check-in từ game
//   - banner nhỏ ở tab Cộng đồng › Quán ăn
// Mọi link sang game gắn ?from=nhopnhep để game chào + tặng quà người tới từ đây.
const CtbtGame = {
  GAME_URL: 'https://bvinh3105.github.io/com-tam-ba-thao/',
  // id quán "Cơm Tấm Bà Thảo" trên PocketBase — điền sau khi tạo quán trên server
  QUAN_ID: 'i99wc0ypelhuxqj',
  STRIP_MAX: 12,
  // Tạm đóng lối vào game (2026-09-29, game đang nâng cấp asset): banner, nút Chơi thử, nhãn 🎮 vẫn hiện,
  // bấm vào chỉ báo "đang cập nhật". Mở lại: đổi thành true.
  PLAY_OPEN: false,

  url(src) {
    const u = new URL(this.GAME_URL);
    u.searchParams.set('from', 'nhopnhep');
    if (src) u.searchParams.set('utm_content', src);
    return u.toString();
  },

  open(src) {
    if (!this.PLAY_OPEN) { showToast(I18N.t('ctbt.updating'), 3000); return; }
    if (typeof Analytics !== 'undefined') Analytics.track('game_open', { src: src || '' });
    window.open(this.url(src), '_blank', 'noopener');
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
