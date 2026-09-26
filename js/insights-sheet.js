/* ═══════════════════════════════════════════════
   THỐNG KÊ — InsightsSheet (2026-09-26)
   Instagram-style insights for the OWNER of a post or of the account,
   drawn in the house style: paper sheet, 2px ink borders, hard offset
   shadows, Nunito italics with <em> in primary. Numbers come only from
   the server through js/insights.js (Insights.post / Insights.me) — this
   file never counts anything itself.

     InsightsSheet.open({ t, id, title, sub, img, onClose })
        one post (t 'checkin' | 'quan'): tiles tiếp cận / xem / vào trang
        cá nhân / chia sẻ, a tương tác row, 14-day views chart, nguồn
        lượt xem, followers-vs-others split, footnote.
     InsightsSheet.openAccount({ onClose })
        the account: 7 / 30 ngày toggle, tiles, daily chart (views + profile
        visits), top posts — tapping one drills into its post view, ← back.
     InsightsSheet.close()

   Its own fixed layer (#insOv, z-index 400: above the check-in viewer's
   300 and the diary's 150, below #toast's 999). Deliberately NOT a
   .modal-overlay — CommunityDetailModal / UserQuanModal / AvatarCtrl hide
   "the first .modal-overlay.show" when they open, and the diary reads any
   .modal-overlay.show as "a modal sits on top of me".

   Tracking started at deploy (TRACK_START on the server), so the footnote
   says where the numbers begin, and chart days before `since` are drawn
   as "chưa ghi" rather than as zeros that would claim nobody looked.
   Close: ✕, backdrop, Escape, swipe down on the handle / title row, and
   (inside the diary) Android Back — see NhatKyCtrl._onPop.
═══════════════════════════════════════════════ */
const InsightsSheet = {
  SRC_KEYS: ['feed', 'discover', 'viewer', 'detail', 'link', 'profile', 'saved', 'map', 'diary', 'group', 'other'],

  _wired: false, _open: false,
  _mode: '',            // 'post' | 'account'
  _post: null,          // { t, id, title, sub, img } on screen
  _fromAccount: false,  // post view reached from the account's top list → show ←
  _acctScroll: 0,
  _days: 7,
  _acct: {},            // days → account payload, kept for this open only
  _data: null, _state: '', _err: null,
  _gen: 0,              // bumped by every load and by close — late answers are dropped
  _onClose: null, _returnFocus: null, _hideT: null,
  _slots: [], _sel: -1, _scrub: null, _drag: null,

  // ── public ──────────────────────────────────────────────
  open({ t, id, title = '', sub = '', img = '', onClose } = {}) {
    if (!id || (t !== 'checkin' && t !== 'quan')) return;
    this._begin(onClose);
    this._fromAccount = false;
    this._showPost({ t, id, title, sub, img });
  },

  openAccount({ onClose } = {}) {
    this._begin(onClose);
    this._acct = {};
    this._days = 7;
    this._fromAccount = false;
    this._showAccount();
  },

  close() {
    if (!this._open) return;
    this._open = false;
    this._gen++;
    this._scrub = null;
    const ov = document.getElementById('insOv');
    this._resetDrag();
    ov.classList.remove('show');
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => {
      if (this._open) return;
      ov.hidden = true;
      document.getElementById('insBody').innerHTML = '';
    }, this._reduced() ? 60 : 320);
    const f = this._returnFocus;
    this._returnFocus = null;
    if (this._focusable(f)) { try { f.focus({ preventScroll: true }); } catch (_) {} }
    else if (ov.contains(document.activeElement)) document.activeElement.blur();
    this._fireClose();
  },

  isOpen() { return this._open; },

  // Sub line for a post header: "Đăng 3 giờ trước" (timeAgo() starts with
  // a capital — "Vừa xong" — which reads wrong mid-sentence).
  postedSub(created) {
    const ago = typeof timeAgo === 'function' ? String(timeAgo(created) || '') : '';
    return ago ? I18N.t('ins.posted', { date: ago.charAt(0).toLowerCase() + ago.slice(1) }) : '';
  },

  // ── open / close plumbing ───────────────────────────────
  _begin(onClose) {
    this._wire();
    // A second caller replacing a sheet that is still up: the first
    // caller's onClose still has to run (the viewer would never resume).
    if (this._open) this._fireClose();
    else this._returnFocus = document.activeElement;
    this._onClose = typeof onClose === 'function' ? onClose : null;
    const ov = document.getElementById('insOv');
    const sheet = document.getElementById('insSheet');
    clearTimeout(this._hideT);
    this._open = true;
    this._resetDrag();
    if (ov.hidden) { ov.hidden = false; void ov.offsetWidth; } // commit the off-screen position so the slide-up animates
    ov.classList.add('show');
    try { sheet.focus({ preventScroll: true }); } catch (_) {}
  },

  _fireClose() {
    const cb = this._onClose;
    this._onClose = null;
    if (cb) { try { cb(); } catch (e) { console.error(e); } }
  },

  _wire() {
    if (this._wired) return;
    this._wired = true;
    const $ = (id) => document.getElementById(id);
    $('insBackdrop').addEventListener('click', () => this.close());
    $('insClose').addEventListener('click', () => this.close());
    $('insBack').addEventListener('click', () => this._backToAccount());
    const body = $('insBody');
    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-ins-retry]')) { this._reload(); return; }
      const d = e.target.closest('[data-ins-days]');
      if (d) { this._setDays(+d.dataset.insDays); return; }
      const top = e.target.closest('[data-ins-top]');
      if (top) this._openTop(+top.dataset.insTop);
    });
    // Chart: tap a day or slide a finger along it to read that day.
    body.addEventListener('pointerdown', (e) => this._scrubStart(e));
    body.addEventListener('pointermove', (e) => this._scrubMove(e));
    body.addEventListener('pointerup', (e) => this._scrubEnd(e));
    body.addEventListener('pointercancel', (e) => this._scrubEnd(e));
    this._wireDrag();
    // Capture on window so the layers underneath never see these keys while
    // the sheet is up: the diary's Escape would close its detail and its
    // arrows would flip meals behind the sheet.
    window.addEventListener('keydown', (e) => this._onKey(e), true);
    document.addEventListener('i18n:changed', () => { if (this._open) this._render(); });
  },

  _onKey(e) {
    if (!this._open) return;
    const sheet = document.getElementById('insSheet');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.stopPropagation();
      const a = document.activeElement;
      if (a && a.classList.contains('ins-chart') && this._slots.length) {
        e.preventDefault();
        const n = this._slots.length, dir = e.key === 'ArrowRight' ? 1 : -1;
        const from = this._sel >= 0 ? this._sel : (dir > 0 ? -1 : n);
        this._select(Math.max(0, Math.min(n - 1, from + dir)));
      }
      return;
    }
    if (e.key !== 'Tab') return;
    // Keep Tab inside the dialog.
    const f = [...sheet.querySelectorAll('button, [tabindex="0"]')].filter(el => !el.disabled && this._focusable(el));
    if (!f.length) { e.preventDefault(); sheet.focus(); return; }
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (e.shiftKey && (a === first || a === sheet || !sheet.contains(a))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (a === last || !sheet.contains(a))) { e.preventDefault(); first.focus(); }
  },

  // Swipe down on the handle or the title row. Buttons in that row keep
  // their taps; the list below scrolls on its own.
  _wireDrag() {
    const sheet = document.getElementById('insSheet');
    [document.getElementById('insGrab'), document.getElementById('insTop')].forEach((zone) => {
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
        const v = d.dy / Math.max(1, performance.now() - d.t); // px per ms
        if (e.type === 'pointerup' && (d.dy > 110 || (d.dy > 40 && v > 0.5))) this.close();
        else this._resetDrag();
      };
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
    });
  },

  _resetDrag() {
    this._drag = null;
    const s = document.getElementById('insSheet');
    if (!s) return;
    s.classList.remove('dragging');
    s.style.transform = '';
  },

  // ── views ───────────────────────────────────────────────
  _showPost(p) {
    this._mode = 'post';
    this._post = p;
    document.getElementById('insBody').scrollTop = 0;
    this._loadPost();
  },

  async _loadPost() {
    const gen = ++this._gen, p = this._post;
    this._state = 'loading'; this._data = null; this._sel = -1;
    this._render();
    const r = await this._call('post', p.t, p.id);
    if (gen !== this._gen) return; // closed or moved on meanwhile
    this._settle(r);
  },

  _showAccount(scroll = 0) {
    this._mode = 'account';
    this._post = null;
    const body = document.getElementById('insBody');
    const cached = this._acct[this._days];
    if (cached) {
      this._gen++; // drop a slower answer for the other range
      this._state = 'ok'; this._data = cached; this._err = null; this._sel = -1;
      this._render();
      body.scrollTop = scroll;
      return;
    }
    body.scrollTop = 0;
    this._loadAccount();
  },

  async _loadAccount() {
    const gen = ++this._gen, days = this._days, cache = this._acct;
    this._state = 'loading'; this._data = null; this._sel = -1;
    this._render();
    const r = await this._call('me', days);
    if (r && r.ok && r.data) cache[days] = r.data; // still useful if the user flipped ranges meanwhile
    if (gen !== this._gen) return;
    this._settle(r);
  },

  _settle(r) {
    if (r && r.ok && r.data) { this._state = 'ok'; this._data = r.data; this._err = null; }
    else { this._state = 'error'; this._data = null; this._err = r || null; }
    this._sel = -1;
    this._render();
  },

  _reload() {
    if (this._mode === 'account') this._loadAccount();
    else if (this._post) this._loadPost();
  },

  _setDays(n) {
    if ((n !== 7 && n !== 30) || !this._open) return;
    if (n === this._days && this._state !== 'error') return;
    this._days = n;
    this._showAccount();
  },

  _openTop(i) {
    const p = this._mode === 'account' && this._data && Array.isArray(this._data.top) ? this._data.top[i] : null;
    if (!p || (p.t !== 'checkin' && p.t !== 'quan') || !p.id) return;
    this._acctScroll = document.getElementById('insBody').scrollTop;
    this._fromAccount = true;
    this._showPost({ t: p.t, id: p.id, title: p.name || '', sub: '', img: this._imgUrl(p.img) });
    try { document.getElementById('insSheet').focus({ preventScroll: true }); } catch (_) {}
  },

  _backToAccount() {
    if (!this._fromAccount) return;
    this._fromAccount = false;
    this._showAccount(this._acctScroll);
    try { document.getElementById('insSheet').focus({ preventScroll: true }); } catch (_) {}
  },

  // Insights (js/insights.js) is written separately — never let a missing
  // or throwing module leave the sheet spinning.
  _call(fn, ...args) {
    if (typeof Insights === 'undefined' || !Insights || typeof Insights[fn] !== 'function') {
      return Promise.resolve({ ok: false, status: 'missing' });
    }
    return Promise.resolve().then(() => Insights[fn](...args)).catch(() => ({ ok: false, status: 0 }));
  },

  // ── render ──────────────────────────────────────────────
  _render() {
    if (!this._open) return;
    const acct = this._mode === 'account';
    document.getElementById('insTitle').innerHTML = I18N.t(acct ? 'ins.titleAccount' : 'ins.titlePost');
    document.getElementById('insBack').classList.toggle('off', acct || !this._fromAccount);
    this._slots = []; // the chart (if this state draws one) refills it
    document.getElementById('insBody').innerHTML = acct ? this._accountHtml() : this._postHtml();
  },

  _postHtml() {
    const p = this._post || {}, d = this._state === 'ok' ? this._data : null;
    const date = d && d.created ? I18N.t('ins.posted', { date: this._dmy(d.created) }) : '';
    const head = `<div class="ins-post">
      ${this._thumbHtml(p.img, p.t)}
      <div class="ins-post-txt"><b>${escapeHtml(p.title || '—')}</b><span>${escapeHtml(p.sub || date)}</span></div>
    </div>`;
    const labels = [['ins.reach', 'ins.reachSub'], ['ins.views'], ['ins.profile'], ['ins.shares']];
    if (this._state === 'loading') return head + this._loadingHtml(labels);
    if (this._state === 'error') return head + this._errorHtml();

    const zero = ['views', 'reach', 'profile', 'shares', 'likes', 'saves', 'comments', 'dir', 'follows'].every(k => !(+d[k] > 0));
    if (zero) {
      // A post older than the tracking start: its earlier views are unknown.
      const pre = d.since && d.created && d.since > d.created;
      return head + `<div class="empty-comm ins-state">
        <div class="em-icon">${svgIcon('action-eye')}</div>
        <div class="em-msg">${pre ? I18N.t('ins.zeroSince', { date: this._dmy(d.since) }) : I18N.t('ins.zero')}</div>
        <div class="em-sub">${I18N.t('ins.zeroSub')}</div>
      </div>` + this._footHtml(d);
    }

    this._slots = this._buildSlots(d.daily, 14, d.since);
    const acts = [
      ['heart-filled', 'ins.likes', d.likes],
      ['action-bookmark', 'ins.saves', d.saves],
      d.comments == null ? null : ['social-comment', 'ins.comments', d.comments],
      ['map-external', 'ins.dir', d.dir],
      ['social-author', 'ins.follows', d.follows],
    ].filter(Boolean);
    return head + `
      <h3 class="ins-h">${I18N.t('ins.overview')}</h3>
      <div class="ins-tiles">
        ${this._tileHtml('ins.reach', d.reach, I18N.t('ins.reachSub'), true)}
        ${this._tileHtml('ins.views', d.views)}
        ${this._tileHtml('ins.profile', d.profile)}
        ${this._tileHtml('ins.shares', d.shares)}
      </div>
      <h3 class="ins-h">${I18N.t('ins.interactions')}</h3>
      <div class="ins-acts">${acts.map(([ic, k, v]) => `<div class="ins-act">${svgIcon(ic)}<b>${this._n(v)}</b><span>${I18N.t(k)}</span></div>`).join('')}</div>
      ${this._chartHtml(I18N.t('ins.chart14'), false)}
      ${this._sourcesHtml(d)}
      ${this._splitHtml(d)}
      ${this._footHtml(d)}`;
  },

  _accountHtml() {
    const seg = `<div class="ins-seg" role="group" aria-label="${escapeHtml(I18N.t('ins.rangeAria'))}">
      ${[7, 30].map(n => `<button type="button" data-ins-days="${n}" class="${n === this._days ? 'on' : ''}" aria-pressed="${n === this._days}">${I18N.t('ins.days', { n })}</button>`).join('')}
    </div>`;
    const labels = [['ins.profile'], ['ins.reach', 'ins.reachSub'], ['ins.views'], ['ins.newFollowers']];
    if (this._state === 'loading') return seg + this._loadingHtml(labels);
    if (this._state === 'error') return seg + this._errorHtml();
    const d = this._data;
    const days = d.days === 30 ? 30 : (d.days === 7 ? 7 : this._days);
    this._slots = this._buildSlots(d.daily, days, d.since);
    return seg + `
      <div class="ins-tiles">
        ${this._tileHtml('ins.profile', d.profile, '', true)}
        ${this._tileHtml('ins.reach', d.reach, I18N.t('ins.reachSub'))}
        ${this._tileHtml('ins.views', d.views)}
        ${this._tileHtml('ins.newFollowers', d.follows, I18N.t('ins.followerTotal', { n: this._n(d.followers) }))}
      </div>
      ${this._chartHtml(I18N.t('ins.chartDays', { n: days }), true)}
      <h3 class="ins-h">${I18N.t('ins.topPosts')}</h3>
      ${this._topHtml(d, this._slots.filter(s => !s.pre).length || days)}
      ${this._footHtml(d)}`;
  },

  _tileHtml(key, v, sub = '', hero = false) {
    return `<div class="ins-tile${hero ? ' hero' : ''}"><small>${I18N.t(key)}</small><b>${this._n(v)}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  },

  _loadingHtml(labels) {
    return `<div class="ins-tiles ins-loading" aria-busy="true">
        ${labels.map(([k, sub], i) => `<div class="ins-tile${i === 0 ? ' hero' : ''}"><small>${I18N.t(k)}</small><b>···</b>${sub ? `<span>${I18N.t(sub)}</span>` : ''}</div>`).join('')}
      </div>
      <p class="ins-wait" role="status">${I18N.t('ins.loading')}</p>`;
  },

  _errorHtml() {
    const r = this._err || {};
    const key = r.status === 404 ? 'ins.notFound'
      : r.status === 401 ? 'ins.needLogin'
      : r.status === 'timeout' ? 'err.serverSlow'
      : r.status === 0 ? 'err.serverUnreachable'
      : 'ins.error';
    return `<div class="empty-comm ins-state" role="alert">
      <div class="em-icon">${svgIcon('status-error-face')}</div>
      <div class="em-msg">${I18N.t(key)}</div>
      ${r.status === 404 || r.status === 401 ? '' : `<button type="button" class="btn-cancel ins-retry" data-ins-retry>${I18N.t('ins.retry')}</button>`}
    </div>`;
  },

  _thumbHtml(url, t) {
    const icon = svgIcon(t === 'quan' ? 'cat-nhahang' : 'nav-checkin');
    return url
      ? `<span class="ins-thumb" style="background-image:url('${escapeHtml(url)}')"></span>`
      : `<span class="ins-thumb empty">${icon}</span>`;
  },

  _topHtml(d, days) {
    const top = Array.isArray(d.top) ? d.top.filter(p => p && p.id) : [];
    if (!top.length) return `<p class="ins-none">${I18N.t('ins.topEmpty', { n: days })}</p>`;
    return `<div class="ins-tops">${top.map((p, i) => `
      <button type="button" class="ins-topp" data-ins-top="${i}">
        ${this._thumbHtml(this._imgUrl(p.img), p.t)}
        <span class="ins-topp-txt">
          <b>${escapeHtml(p.name || '—')}</b>
          <span>${I18N.t(p.t === 'quan' ? 'ins.typeQuan' : 'ins.typeCheckin')} · ${I18N.t('ins.topMeta', { r: this._n(p.reach), v: this._n(p.views) })}</span>
        </span>
        <span class="ins-chev" aria-hidden="true">›</span>
      </button>`).join('')}</div>`;
  },

  _sourcesHtml(d) {
    const acc = {};
    Object.keys(d.sources || {}).forEach((k) => {
      const key = this.SRC_KEYS.includes(k) ? k : 'other';
      acc[key] = (acc[key] || 0) + (+d.sources[k] || 0);
    });
    const rows = Object.entries(acc).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return '';
    const max = rows[0][1], pct = this._pcts(rows.map(([, v]) => v));
    return `<h3 class="ins-h">${I18N.t('ins.sources')}</h3>
      <div class="ins-card ins-srcs">${rows.map(([k, v], i) => `
        <div class="ins-src">
          <span class="ins-src-l">${I18N.t('ins.src.' + k)}</span>
          <span class="ins-src-t"><i style="width:${Math.max(3, Math.round(v / max * 100))}%"></i></span>
          <b>${this._n(v)}</b><small>${pct[i]}%</small>
        </div>`).join('')}
      </div>`;
  },

  _splitHtml(d) {
    const f = Math.max(0, +d.reach_followers || 0), o = Math.max(0, +d.reach_others || 0), tot = f + o;
    if (!tot) return '';
    const pf = Math.round(f / tot * 100), po = 100 - pf;
    return `<h3 class="ins-h">${I18N.t('ins.reachSplit')}</h3>
      <div class="ins-card">
        <div class="ins-split" role="img" aria-label="${escapeHtml(`${I18N.t('ins.followers')} ${pf}% · ${I18N.t('ins.nonFollowers')} ${po}%`)}">
          ${f ? `<i class="f" style="width:${pf}%"></i>` : ''}${o ? `<i class="o" style="width:${po}%"></i>` : ''}
        </div>
        <div class="ins-leg">
          <span><i class="f"></i>${I18N.t('ins.followers')}<b>${this._n(f)}</b><small>${pf}%</small></span>
          <span><i class="o"></i>${I18N.t('ins.nonFollowers')}<b>${this._n(o)}</b><small>${po}%</small></span>
        </div>
      </div>`;
  },

  _footHtml(d) {
    return `<p class="ins-foot">${I18N.t('ins.footnote', { date: this._dmy(d && d.since) || '—' })}</p>`;
  },

  // ── chart ───────────────────────────────────────────────
  // One slot per VN day ending on the server's last day (today). Days
  // before `since` are "pre": not tracked yet, drawn dashed, never "0".
  _buildSlots(daily, n, since) {
    const list = Array.isArray(daily) ? daily.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.d)) : [];
    const map = new Map(list.map(x => [x.d, x]));
    const end = list.length ? list.reduce((m, x) => (x.d > m ? x.d : m), list[0].d) : this._vnDay(Date.now());
    const sinceDay = this._vnDay(since);
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = this._addDays(end, -i), x = map.get(d);
      out.push({
        d, today: i === 0,
        pre: !x && !!sinceDay && d < sinceDay,
        views: Math.max(0, +(x && x.views) || 0),
        reach: Math.max(0, +(x && x.reach) || 0),
        profile: Math.max(0, +(x && x.profile) || 0),
      });
    }
    return out;
  },

  _peak() {
    let best = -1, max = 0;
    this._slots.forEach((s, i) => { if (!s.pre && s.views > 0 && s.views >= max) { max = s.views; best = i; } });
    return best;
  },

  _chartHtml(title, acct) {
    const sl = this._slots, n = sl.length;
    if (!n) return '';
    const max = Math.max(1, ...sl.map(s => (acct ? Math.max(s.views, s.profile) : s.views)));
    const pk = this._peak();
    const every = n > 14 ? 5 : 1; // 30 days: label today and every 5th day back
    const h = (v) => (v > 0 ? Math.max(4, Math.round(v / max * 100)) : 0);
    const bar = (v, cls) => `<span class="ins-bar${cls}${v > 0 ? '' : ' z'}" style="--h:${h(v)}" data-v="${this._n(v)}"></span>`;
    const cols = sl.map((s, i) => {
      const cls = ['ins-col', s.today ? 'today' : '', s.pre ? 'pre' : '', i === pk ? 'peak' : '', i === this._sel ? 'sel' : ''].filter(Boolean).join(' ');
      return `<span class="${cls}"><span class="ins-bars">${bar(s.views, '')}${acct ? bar(s.profile, ' p') : ''}</span></span>`;
    }).join('');
    const axis = sl.map((s, i) => {
      const show = every === 1 || (n - 1 - i) % every === 0;
      return `<span class="${s.today ? 'today' : ''}">${show ? `<b>${this._dow(s.d)}</b>${this._dayNum(s.d)}` : ''}</span>`;
    }).join('');
    const hasPre = sl.some(s => s.pre);
    const legend = (acct || hasPre) ? `<div class="ins-cleg">
        ${acct ? `<span><i class="v"></i>${I18N.t('ins.views')}</span><span><i class="p"></i>${I18N.t('ins.profile')}</span>` : ''}
        ${hasPre ? `<span><i class="pre"></i>${I18N.t('ins.untracked')}</span>` : ''}
      </div>` : '';
    return `<h3 class="ins-h">${title}</h3>
      <div class="ins-card ins-chart-card${n > 14 ? ' dense' : ''}">
        <div class="ins-chart${this._sel >= 0 ? ' has-sel' : ''}" tabindex="0" role="group" aria-roledescription="${escapeHtml(I18N.t('ins.chartRole'))}" aria-label="${escapeHtml(title)}" aria-describedby="insCap">${cols}</div>
        <div class="ins-axis" aria-hidden="true">${axis}</div>
        <p class="ins-cap" id="insCap" aria-live="polite">${escapeHtml(this._caption())}</p>
        ${legend}
      </div>`;
  },

  _caption() {
    const sl = this._slots;
    if (!sl.length) return '';
    const acct = this._mode === 'account';
    if (this._sel >= 0 && sl[this._sel]) {
      const s = sl[this._sel], day = this._dayLabel(s.d);
      if (s.pre) return I18N.t('ins.capUntracked', { day });
      return acct
        ? I18N.t('ins.capDayAcct', { day, v: this._n(s.views), p: this._n(s.profile) })
        : I18N.t('ins.capDay', { day, v: this._n(s.views), r: this._n(s.reach) });
    }
    const pk = this._peak();
    // Only the days that were actually tracked can be "days with no views".
    if (pk < 0) return I18N.t('ins.capNone', { n: sl.filter(s => !s.pre).length || 1 });
    return I18N.t('ins.capPeak', { day: this._dayLabel(sl[pk].d), v: this._n(sl[pk].views) });
  },

  // Update in place (no re-render) so a finger sliding along the chart
  // doesn't rebuild the whole sheet on every pointermove.
  _select(i) {
    this._sel = i;
    const chart = document.querySelector('#insBody .ins-chart');
    if (!chart) return;
    chart.classList.toggle('has-sel', i >= 0);
    chart.querySelectorAll('.ins-col').forEach((c, k) => c.classList.toggle('sel', k === i));
    const cap = document.getElementById('insCap');
    if (cap) cap.textContent = this._caption();
  },

  _colAt(chart, x) {
    const r = chart.getBoundingClientRect(), n = this._slots.length;
    return Math.max(0, Math.min(n - 1, Math.floor((x - r.left) / Math.max(1, r.width) * n)));
  },

  _scrubStart(e) {
    const chart = e.target.closest('.ins-chart');
    if (!chart || !this._slots.length || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const i = this._colAt(chart, e.clientX);
    this._scrub = { id: e.pointerId, x: e.clientX, moved: false, start: i, prev: this._sel };
    this._select(i);
  },
  _scrubMove(e) {
    const s = this._scrub;
    if (!s || e.pointerId !== s.id) return;
    const chart = document.querySelector('#insBody .ins-chart');
    if (!chart) return;
    if (Math.abs(e.clientX - s.x) > 6) s.moved = true;
    if (s.moved) this._select(this._colAt(chart, e.clientX));
  },
  _scrubEnd(e) {
    const s = this._scrub;
    if (!s || e.pointerId !== s.id) return;
    this._scrub = null;
    // Tapping the day that was already picked goes back to the peak label.
    if (e.type === 'pointerup' && !s.moved && s.prev === s.start) this._select(-1);
  },

  // ── helpers ─────────────────────────────────────────────
  // Whole percentages that add up to exactly 100 (largest remainder).
  _pcts(vals) {
    const tot = vals.reduce((s, v) => s + v, 0);
    if (!tot) return vals.map(() => 0);
    const raw = vals.map(v => v / tot * 100), out = raw.map(Math.floor);
    let left = 100 - out.reduce((s, v) => s + v, 0);
    raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
    return out;
  },
  _n(v) {
    const n = Number(v) || 0;
    if (typeof Insights !== 'undefined' && Insights && typeof Insights.fmt === 'function') {
      try { const s = Insights.fmt(n); if (s != null && s !== '') return escapeHtml(String(s)); } catch (_) {}
    }
    return n.toLocaleString(I18N.lang === 'en' ? 'en-US' : 'vi-VN');
  },
  // API image paths are relative to the backend ("/api/files/…").
  _imgUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return Community.BASE_URL + (String(path).startsWith('/') ? '' : '/') + path;
  },
  // Days are Việt Nam days (UTC+7, no DST) — the same calendar the server buckets by.
  _vnDay(v) {
    const t = typeof v === 'number' ? v : Date.parse(String(v || '').replace(' ', 'T'));
    return isNaN(t) ? '' : new Date(t + 7 * 3600e3).toISOString().slice(0, 10);
  },
  _addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  },
  _dow(key) {
    const [y, m, d] = key.split('-').map(Number);
    return I18N.t('ins.dow').split(',')[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || '';
  },
  _dayNum(key) { return String(+key.slice(8, 10)); },
  _dayLabel(key) { return `${this._dow(key)} ${+key.slice(8, 10)}/${+key.slice(5, 7)}`; },
  _dmy(v) {
    const k = this._vnDay(v);
    return k ? `${+k.slice(8, 10)}/${+k.slice(5, 7)}/${k.slice(0, 4)}` : '';
  },
  _reduced() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); },
  _focusable(el) {
    if (!el || !el.isConnected || typeof el.focus !== 'function' || el === document.body) return false;
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    // pointer-events is inherited: an item inside a closed popover (e.g. the
    // viewer's ••• panel) reads 'none' — don't send focus back into it.
    return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
  },
};
