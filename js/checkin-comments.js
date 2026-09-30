/* ═══════════════════════════════════════════════
   BÌNH LUẬN CHECK-IN — CheckinCommentSheet (2026-09-30)
   A bottom sheet for commenting on a check-in, opened from
   CheckinViewerCtrl's new "Bình luận" action button. Same fixed-layer
   chrome as InsightsSheet (reuses its .ins-* CSS verbatim — that's
   generic bottom-sheet styling, not insights-specific), own ids so the
   two sheets never collide or interfere; content reuses
   CommunityDetailModal's plain .comment-* classes — same list row,
   same input row, same visual language as commenting on a quán post.

     CheckinCommentSheet.open({ checkinId, ownerId, onClose })
     CheckinCommentSheet.close()
     CheckinCommentSheet.isOpen()

   Server: js/community.js Community.listCheckinComments/createCheckin
   Comment/deleteCheckinComment → PocketBase collection checkin_comments
   (migration 1790000800), whose visibility mirrors the check-in's own
   (private/friends/public/game) — see that migration's header. Loaded
   lazily on open only, never polled — same deliberate choice quán
   comments made (PROJECT_HANDOFF §4: don't add another poll loop on top
   of the already-flaky Cloudflare Quick Tunnel).

   Close: ✕, backdrop, Escape, swipe down on the handle/title row.
═══════════════════════════════════════════════ */
const CheckinCommentSheet = {
  _wired: false, _open: false,
  _checkinId: '', _ownerId: '',
  _items: [], _state: '', // '' | 'loading' | 'ok' | 'error'
  _gen: 0,
  _onClose: null, _returnFocus: null, _hideT: null,
  _drag: null,

  // ── public ──────────────────────────────────────────────
  open({ checkinId, ownerId = '', onClose } = {}) {
    if (!checkinId) return;
    this._wire();
    if (this._open) this._fireClose(); // a second caller replacing a still-open sheet
    else this._returnFocus = document.activeElement;
    this._checkinId = checkinId;
    this._ownerId = ownerId;
    this._onClose = typeof onClose === 'function' ? onClose : null;

    const ov = document.getElementById('ccOv');
    const sheet = document.getElementById('ccSheet');
    clearTimeout(this._hideT);
    this._open = true;
    this._resetDrag();
    if (ov.hidden) { ov.hidden = false; void ov.offsetWidth; } // commit off-screen position so the slide-up animates
    ov.classList.add('show');
    try { sheet.focus({ preventScroll: true }); } catch (_) {}
    this._load();
  },

  close() {
    if (!this._open) return;
    this._open = false;
    this._gen++;
    const ov = document.getElementById('ccOv');
    this._resetDrag();
    ov.classList.remove('show');
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => {
      if (this._open) return;
      ov.hidden = true;
      document.getElementById('ccList').innerHTML = '';
    }, this._reduced() ? 60 : 320);
    const f = this._returnFocus;
    this._returnFocus = null;
    if (this._focusable(f)) { try { f.focus({ preventScroll: true }); } catch (_) {} }
    else if (ov.contains(document.activeElement)) document.activeElement.blur();
    this._fireClose();
  },

  isOpen() { return this._open; },

  // ── plumbing ────────────────────────────────────────────
  _fireClose() {
    const cb = this._onClose;
    this._onClose = null;
    if (cb) { try { cb(); } catch (e) { console.error(e); } }
  },

  _wire() {
    if (this._wired) return;
    this._wired = true;
    const $ = (id) => document.getElementById(id);
    $('ccBackdrop').addEventListener('click', () => this.close());
    $('ccClose').addEventListener('click', () => this.close());
    $('ccSend').addEventListener('click', () => this._submit());
    $('ccInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._submit(); });
    $('ccList').addEventListener('click', (e) => {
      const btn = e.target.closest('.comment-del-btn');
      if (btn) this._delete(btn.dataset.id);
    });
    this._wireDrag();
    window.addEventListener('keydown', (e) => this._onKey(e), true);
    document.addEventListener('i18n:changed', () => { if (this._open) this._render(); });
  },

  _onKey(e) {
    if (!this._open) return;
    const sheet = document.getElementById('ccSheet');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...sheet.querySelectorAll('button, input, [tabindex="0"]')].filter(el => !el.disabled && this._focusable(el));
    if (!f.length) { e.preventDefault(); sheet.focus(); return; }
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (e.shiftKey && (a === first || a === sheet || !sheet.contains(a))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (a === last || !sheet.contains(a))) { e.preventDefault(); first.focus(); }
  },

  // Swipe down on the handle or the title row — identical to InsightsSheet.
  _wireDrag() {
    const sheet = document.getElementById('ccSheet');
    [document.getElementById('ccGrab'), document.getElementById('ccTop')].forEach((zone) => {
      zone.addEventListener('pointerdown', (e) => {
        if (!this._open || e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
        this._drag = { id: e.pointerId, y: e.clientY, t: performance.now(), dy: 0 };
        try { zone.setPointerCapture(e.pointerId); } catch (_) {}
        sheet.classList.add('dragging');
      });
      zone.addEventListener('pointermove', (e) => {
        const d = this._drag;
        if (!d || e.pointerId !== d.id) return;
        d.dy = Math.max(0, e.clientY - d.y);
        sheet.style.transform = d.dy ? `translateY(${d.dy}px)` : '';
      });
      const end = (e) => {
        const d = this._drag;
        if (!d || e.pointerId !== d.id) return;
        const v = d.dy / Math.max(1, performance.now() - d.t);
        if (e.type === 'pointerup' && (d.dy > 110 || (d.dy > 40 && v > 0.5))) this.close();
        else this._resetDrag();
      };
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
    });
  },
  _resetDrag() {
    this._drag = null;
    const s = document.getElementById('ccSheet');
    if (!s) return;
    s.classList.remove('dragging');
    s.style.transform = '';
  },

  // ── data ────────────────────────────────────────────────
  async _load() {
    const gen = ++this._gen;
    this._state = 'loading';
    this._render();
    const r = await Community.listCheckinComments(this._checkinId);
    if (gen !== this._gen) return; // closed or moved on meanwhile
    if (r.ok) { this._items = (r.data && r.data.items) || []; this._state = 'ok'; }
    else { this._items = []; this._state = 'error'; }
    this._render();
  },

  _render() {
    if (!this._open) return;
    const list = document.getElementById('ccList');
    if (this._state === 'loading') {
      list.innerHTML = `<div class="comment-loading">${I18N.t('ins.loading')}</div>`;
      return;
    }
    if (this._state === 'error') {
      list.innerHTML = `<div class="comment-empty">${I18N.t('comment.loadFail')}</div>`;
      return;
    }
    if (!this._items.length) {
      list.innerHTML = `<div class="comment-empty">${I18N.t('comment.empty')}</div>`;
      return;
    }
    const myId = Community.currentUser && Community.currentUser.id;
    list.innerHTML = this._items.map(c => {
      const author = c.expand && c.expand.user;
      const authorName = (author && author.name) || I18N.t('common.anonymous');
      const canDelete = myId && (c.user === myId || this._ownerId === myId);
      return `<div class="comment-row" data-id="${c.id}">
        <div class="comment-avatar">${authorAvatar(author)}</div>
        <div class="comment-body">
          <div class="comment-meta"><span class="comment-author">${escapeHtml(authorName)}</span><span class="comment-time">${timeAgo(c.created)}</span></div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
        </div>
        ${canDelete ? `<button class="comment-del-btn" data-id="${c.id}" title="${I18N.t('common.close')}">${svgIcon('action-close')}</button>` : ''}
      </div>`;
    }).join('');
  },

  async _submit() {
    const input = document.getElementById('ccInput');
    const text = input.value.trim();
    if (!Community.isLoggedIn()) { showToast(I18N.t('toast.commentNeedLogin')); return; }
    if (!text) { showToast(I18N.t('toast.commentEmpty')); return; }
    const btn = document.getElementById('ccSend');
    btn.disabled = true; input.disabled = true;
    const res = await Community.createCheckinComment(this._checkinId, text);
    btn.disabled = false; input.disabled = false;
    if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
    input.value = '';
    if (typeof Analytics !== 'undefined') Analytics.track('comment_post', { on: 'checkin' });
    this._load();
    // The count row on the viewer behind this sheet is now one stale —
    // let it refresh silently (best-effort, no await/await-chain needed).
    if (typeof CheckinViewerCtrl !== 'undefined') CheckinViewerCtrl._refreshCounts(this._checkinId);
  },

  async _delete(id) {
    if (!confirm(I18N.t('comment.confirmDelete'))) return;
    const res = await Community.deleteCheckinComment(id);
    if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
    showToast(I18N.t('toast.commentDeleted'));
    this._load();
    if (typeof CheckinViewerCtrl !== 'undefined') CheckinViewerCtrl._refreshCounts(this._checkinId);
  },

  // ── helpers (mirrors InsightsSheet's own copies) ─────────
  _reduced() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); },
  _focusable(el) {
    if (!el || !el.isConnected || typeof el.focus !== 'function' || el === document.body) return false;
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
  },
};
