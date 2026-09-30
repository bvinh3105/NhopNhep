/* ═══════════════════════════════════════════════
   NHẮN TIN — DmCtrl (2026-09-30)
   Direct messages between two users, 1:1 only (no group chat, no
   leave/delete conversation, no block list yet — v1 scope). Own full-
   screen layer (#dmRoot, z-index 260 — see the CSS block's header
   comment for why), two internal views toggled by .hidden: the inbox
   (list of conversations) and one thread (messages + input), same idea
   as NhatKyCtrl's calendar/detail split but with just two levels.

   Entry points: the bell button on Trang chủ (open()) and "Nhắn tin" in
   UserQuanModal (openThreadWith(userId, userName, userObj) — jumps
   straight to a thread, which may have no conversation yet; sending
   creates one lazily, same "find or create" the server does).

   No realtime — PocketBase's SSE doesn't survive the Cloudflare Quick
   Tunnel (see js/community.js's own note on this). An open thread polls
   for new messages every few seconds (same idea as CommunityCtrl's live
   feed poll); the unread bell badge polls separately, independent of
   whether this sheet is even open, same cadence class as that feed poll.
   Server: js/community.js Community.dm* → pb_hooks/dm.pb.js + dm_lib.js,
   collections dm_conversations/dm_messages (migrations 1790000900/901).
═══════════════════════════════════════════════ */
const DmCtrl = {
  BADGE_POLL_MS: 20000,
  THREAD_POLL_MS: 3500,

  _wired: false, _open: false,
  _view: 'inbox', // 'inbox' | 'thread'
  _conversations: [],
  _threadConvId: '', _threadOtherId: '', _threadOtherName: '', _threadOtherObj: null,
  _messages: [],
  _pollTimer: null, _badgeTimer: null,
  _gen: 0, _returnFocus: null,

  init() {
    this._wire();
    document.getElementById('homeBellBtn')?.addEventListener('click', () => this.open());
    this._syncBadgePoll();
    document.addEventListener('visibilitychange', () => this._syncBadgePoll());
    // Logging out mid-session: no more badge, and the sheet (if open)
    // shouldn't keep showing someone else's inbox after a relogin.
    document.addEventListener('community:session-expired', () => {
      this._syncBadgePoll();
      if (this._open) this.close();
    });
  },

  _wire() {
    if (this._wired) return;
    this._wired = true;
    const $ = (id) => document.getElementById(id);
    $('dmBackdrop').addEventListener('click', () => this.close());
    $('dmCloseBtn').addEventListener('click', () => this.close());
    $('dmThreadClose').addEventListener('click', () => this.close());
    $('dmThreadBack').addEventListener('click', () => this._showInbox());
    $('dmConvList').addEventListener('click', (e) => {
      const row = e.target.closest('.dm-conv-row');
      if (row) this._openConversationRow(row.dataset.id);
    });
    $('dmSendBtn').addEventListener('click', () => this._send());
    $('dmInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._send(); });
    window.addEventListener('keydown', (e) => {
      if (!this._open || e.key !== 'Escape') return;
      e.preventDefault();
      if (this._view === 'thread') this._showInbox(); else this.close();
    }, true);
    document.addEventListener('i18n:changed', () => {
      if (this._open && this._view === 'inbox') this._renderInbox();
      if (this._open && this._view === 'thread') this._renderMessages();
    });
  },

  // ── open/close ──────────────────────────────────────────
  _openRoot() {
    this._wire();
    this._open = true;
    this._returnFocus = document.activeElement;
    const root = document.getElementById('dmRoot');
    if (root.hidden) { root.hidden = false; void root.offsetWidth; } // commit off-screen position first
    root.classList.add('show');
    try { document.getElementById('dmSheet').focus({ preventScroll: true }); } catch (_) {}
  },

  open() {
    if (!Community.isLoggedIn()) { showToast(I18N.t('err.needLogin')); if (typeof CommunityCtrl !== 'undefined') CommunityCtrl.showAuthPrompt('login'); return; }
    this._openRoot();
    this._showInbox();
  },

  // Straight to a thread with a specific person (from UserQuanModal). May
  // have no conversation yet — sending one creates it; meanwhile look for
  // an existing one so prior history still loads.
  openThreadWith(userId, userName, userObj) {
    if (!userId || (Community.currentUser && userId === Community.currentUser.id)) return;
    if (!Community.isLoggedIn()) { showToast(I18N.t('err.needLogin')); if (typeof CommunityCtrl !== 'undefined') CommunityCtrl.showAuthPrompt('login'); return; }
    this._openRoot();
    this._threadConvId = '';
    this._threadOtherId = userId;
    this._threadOtherName = userName || I18N.t('common.thisPerson');
    this._threadOtherObj = userObj || null;
    this._messages = [];
    this._showThread();
    this._findExistingConversation(userId);
  },

  close() {
    if (!this._open) return;
    this._open = false;
    this._stopPoll();
    this._gen++;
    const root = document.getElementById('dmRoot');
    root.classList.remove('show');
    setTimeout(() => { if (!this._open) root.hidden = true; }, 320);
    const f = this._returnFocus;
    this._returnFocus = null;
    if (f && f.isConnected && typeof f.focus === 'function') { try { f.focus({ preventScroll: true }); } catch (_) {} }
    this._refreshBadge(); // reading a thread may have zeroed some unread counts
  },

  isOpen() { return this._open; },

  // ── inbox ───────────────────────────────────────────────
  _showInbox() {
    this._view = 'inbox';
    this._stopPoll();
    document.getElementById('dmInboxView').classList.remove('hidden');
    document.getElementById('dmThreadView').classList.add('hidden');
    this._loadInbox();
  },

  async _loadInbox() {
    const gen = ++this._gen;
    const list = document.getElementById('dmConvList');
    list.innerHTML = `<div class="dm-empty">${I18N.t('ins.loading')}</div>`;
    const r = await Community.dmConversations();
    if (gen !== this._gen) return;
    if (!r.ok) { list.innerHTML = `<div class="dm-empty">${I18N.t('err.connectionGeneric')}</div>`; return; }
    this._conversations = (r.data && r.data.items) || [];
    this._renderInbox();
  },

  _renderInbox() {
    const list = document.getElementById('dmConvList');
    if (!this._conversations.length) { list.innerHTML = `<div class="dm-empty">${I18N.t('dm.empty')}</div>`; return; }
    const me = Community.currentUser && Community.currentUser.id;
    list.innerHTML = this._conversations.map(c => {
      const isA = c.user_a === me;
      const other = (c.expand && (isA ? c.expand.user_b : c.expand.user_a)) || null;
      const otherId = isA ? c.user_b : c.user_a;
      const unread = (isA ? c.unread_a : c.unread_b) || 0;
      const name = (other && other.name) || I18N.t('common.anonymous');
      const mine = c.last_sender === me;
      const preview = escapeHtml(c.last_text || '');
      return `<button type="button" class="dm-conv-row${unread ? ' unread' : ''}" data-id="${c.id}">
        <div class="dm-conv-avatar">${authorAvatar(other)}</div>
        <div class="dm-conv-body">
          <div class="dm-conv-name">${escapeHtml(name)}</div>
          <div class="dm-conv-preview">${mine ? I18N.t('dm.youPrefix') + ' ' : ''}${preview}</div>
        </div>
        <div class="dm-conv-meta">
          <span class="dm-conv-time">${c.last_at ? timeAgo(c.last_at) : ''}</span>
          ${unread ? '<span class="dm-conv-dot"></span>' : ''}
        </div>
      </button>`;
    }).join('');
  },

  _openConversationRow(convId) {
    const c = this._conversations.find(x => x.id === convId);
    if (!c) return;
    const me = Community.currentUser.id;
    const isA = c.user_a === me;
    const other = (c.expand && (isA ? c.expand.user_b : c.expand.user_a)) || null;
    this._threadConvId = convId;
    this._threadOtherId = isA ? c.user_b : c.user_a;
    this._threadOtherName = (other && other.name) || I18N.t('common.anonymous');
    this._threadOtherObj = other;
    this._messages = [];
    this._showThread();
    this._loadMessages();
  },

  async _findExistingConversation(userId) {
    const gen = this._gen;
    const r = await Community.dmConversations();
    if (gen !== this._gen || this._threadOtherId !== userId) return; // closed / moved on meanwhile
    if (!r.ok) return;
    const row = (r.data.items || []).find(c => c.user_a === userId || c.user_b === userId);
    if (!row) return;
    this._threadConvId = row.id;
    this._loadMessages();
  },

  // ── thread ──────────────────────────────────────────────
  _showThread() {
    this._view = 'thread';
    document.getElementById('dmInboxView').classList.add('hidden');
    document.getElementById('dmThreadView').classList.remove('hidden');
    document.getElementById('dmThreadName').textContent = this._threadOtherName;
    document.getElementById('dmThreadAvatar').innerHTML = authorAvatar(this._threadOtherObj);
    document.getElementById('dmInput').value = '';
    this._renderMessages();
    this._startPoll();
  },

  async _loadMessages() {
    if (!this._threadConvId) { this._messages = []; this._renderMessages(); return; }
    const gen = this._gen;
    const r = await Community.dmMessages(this._threadConvId);
    if (gen !== this._gen || this._view !== 'thread') return;
    if (r.ok) {
      this._messages = r.data.items || [];
      this._renderMessages();
      // A reply that arrived WHILE the thread was already open (via this
      // same poll) still bumped the server's unread counter — the thread
      // being visibly open right now is itself "read", so clear it every
      // time, not just on first open. Community.dmMarkRead no-ops cheaply
      // when there's nothing to clear.
      this._markThreadRead();
    }
  },

  _markThreadRead() {
    if (!this._threadConvId) return;
    Community.dmMarkRead(this._threadConvId).then(() => this._refreshBadge());
  },

  _renderMessages() {
    const box = document.getElementById('dmMsgs');
    if (!box) return;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    if (!this._messages.length) {
      box.innerHTML = `<div class="dm-empty">${I18N.t('dm.emptyThread', { name: escapeHtml(this._threadOtherName) })}</div>`;
      return;
    }
    const me = Community.currentUser && Community.currentUser.id;
    box.innerHTML = this._messages.map(m => `
      <div class="dm-bubble-row${m.sender === me ? ' mine' : ''}">
        <div class="dm-bubble">${escapeHtml(m.text)}<span class="dm-bubble-time">${timeAgo(m.created)}</span></div>
      </div>`).join('');
    if (atBottom) box.scrollTop = box.scrollHeight;
  },

  async _send() {
    const input = document.getElementById('dmInput');
    const text = input.value.trim();
    if (!text || !this._threadOtherId) return;
    const btn = document.getElementById('dmSendBtn');
    btn.disabled = true; input.disabled = true;
    const r = await Community.dmSend(this._threadOtherId, text);
    btn.disabled = false; input.disabled = false;
    if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
    input.value = '';
    this._threadConvId = r.data.conversation;
    await this._loadMessages();
    const box = document.getElementById('dmMsgs');
    if (box) box.scrollTop = box.scrollHeight;
  },

  // ── polling ─────────────────────────────────────────────
  _startPoll() {
    this._stopPoll();
    this._pollTimer = setInterval(() => {
      if (this._open && this._view === 'thread' && document.visibilityState === 'visible') this._loadMessages();
    }, this.THREAD_POLL_MS);
  },
  _stopPoll() { clearInterval(this._pollTimer); this._pollTimer = null; },

  // Global unread badge — polled whenever logged in AND the tab is
  // visible, independent of whether this sheet is open at all.
  _syncBadgePoll() {
    clearInterval(this._badgeTimer); this._badgeTimer = null;
    if (Community.isLoggedIn() && document.visibilityState === 'visible') {
      this._refreshBadge();
      this._badgeTimer = setInterval(() => this._refreshBadge(), this.BADGE_POLL_MS);
    } else {
      this._setBadge(0);
    }
  },
  async _refreshBadge() {
    if (!Community.isLoggedIn()) { this._setBadge(0); return; }
    this._setBadge(await Community.dmUnreadTotal());
  },
  _setBadge(n) {
    document.getElementById('dmBadge')?.classList.toggle('show', n > 0);
  },
};
