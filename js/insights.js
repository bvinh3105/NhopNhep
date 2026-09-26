/* ═══════════════════════════════════════════════
   INSIGHTS — "Thống kê" bài đăng kiểu Instagram, CHỈ chủ bài xem được
   Client side of the post-insights feature (server: pb_hooks/
   nn_insights.pb.js on the community server). Three jobs:
   - hit(): record one interaction (view, share, "Đi tới", profile visit,
     like/save toggles, follow) against a check-in, a quán or a profile.
   - post() / me(): read the owner-only numbers for one post / the whole
     account (used by InsightsSheet in js/insights-sheet.js).
   - fmt(): the one number formatter those numbers are shown with.

   Rules for hit() (agreed with the owner):
   - Fire-and-forget, never throws, never shows UI — a dropped event is
     fine, a broken tap is not.
   - NOT routed through Community._fetch(): its 401 handling logs the user
     out, and a background counter must never do that. An expired token
     just counts as a guest server-side.
   - Own content never counts (skipped here when the caller passes
     o.owner, and again on the server from the auth token).
   - view/profile go out at most once per page session per target; the
     server dedupes again (30 min per viewer), so re-renders, the 20s feed
     poll or re-opening the same post don't inflate anything.
   - Guests are told apart by a random device key (localStorage 'nn_dk');
     the server stores only a hash of it.
   - The path is deliberately neutral (/api/nn/v): anything with
     "analytics"/"track"/"event" in a cross-origin URL gets eaten by ad
     blockers (see the note in js/analytics.js).
═══════════════════════════════════════════════ */

const Insights = {
  DK_KEY: 'nn_dk',
  ID_RE: /^[a-z0-9]{15}$/,    // PocketBase record id — anything else would only earn a 400
  _sent: new Set(),           // `${k}:${t}:${id}` of view/profile hits sent this page session
  _dk: '',                    // device key, cached (also the in-memory fallback when storage throws)

  // ── Device key — random 32 chars, kept forever per browser ──────────
  deviceKey() {
    if (this._dk) return this._dk;
    let k = '';
    try { k = localStorage.getItem(this.DK_KEY) || ''; } catch (_) {}
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(k)) {
      k = this._randomKey(32);
      try { localStorage.setItem(this.DK_KEY, k); } catch (_) {}
    }
    this._dk = k;
    return k;
  },
  _randomKey(len) {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(len);
    try { crypto.getRandomValues(bytes); }
    catch (_) { for (let i = 0; i < len; i++) bytes[i] = Math.random() * 256; }
    let s = '';
    for (let i = 0; i < len; i++) s += abc[bytes[i] % abc.length];
    return s;
  },

  // ── Record one interaction ───────────────────────────────────────────
  // k: view|share|dir|profile|like|unlike|save|unsave|follow
  // t: checkin|quan|user · id: the target record id
  // o.s: where it happened (feed/discover/viewer/detail/link/profile/
  //      saved/map/diary/group/other — the server whitelists it)
  // o.vt + o.vid: for profile/follow, the post the visit came from
  // o.owner: the target's owner id, so our own content is skipped here
  //      without even a request
  hit(k, t, id, o = {}) {
    try {
      if (!k || !t || !id || !this.ID_RE.test(id)) return;
      const me = Community.isLoggedIn() ? Community.currentUser : null;
      if (o.owner && me && o.owner === me.id) return;
      const once = k === 'view' || k === 'profile';
      const key = `${k}:${t}:${id}`;
      if (once && this._sent.has(key)) return;

      const body = { k, t, id, d: this.deviceKey() };
      if (o.s) body.s = String(o.s);
      if (o.vt && o.vid && this.ID_RE.test(o.vid)) { body.vt = o.vt; body.vid = o.vid; }
      const headers = { 'Content-Type': 'application/json' };
      if (me) headers['Authorization'] = Community.token;   // raw token, same as Community._fetch

      if (once) this._sent.add(key);
      // keepalive: a share/"Đi tới" tap can be followed right away by a
      // navigation (Google Maps, closing the tab) — let the request finish.
      fetch(`${Community.BASE_URL}/api/nn/v`, {
        method: 'POST', headers, body: JSON.stringify(body), keepalive: true,
      }).catch(() => {});
    } catch (_) { /* a counter must never break the tap that triggered it */ }
  },

  // ── Owner-only reads (need login; the server 404s anyone else) ───────
  // Both → { ok, data } | { ok:false, status, error } like every Community call.
  post(t, id) {
    return Community._fetch(`/api/nn/p/${encodeURIComponent(t)}/${encodeURIComponent(id)}`);
  },
  me(days = 7) {
    return Community._fetch(`/api/nn/me?days=${days === 30 ? 30 : 7}`);
  },

  // ── Number formatting ────────────────────────────────────────────────
  // < 10 000 → full number with the locale's grouping ("1.234" / "1,234");
  // ≥ 10 000 → compact ("12,3 N" / "12.3K", "1,2 Tr" / "1.2M").
  fmt(n) {
    const v = Math.round(Number(n) || 0);
    const en = typeof I18N !== 'undefined' && I18N.lang === 'en';
    const loc = en ? 'en-US' : 'vi-VN';
    try {
      if (Math.abs(v) < 10000) return v.toLocaleString(loc);
      return new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
    } catch (_) {
      // Very old engines: no Intl compact notation — same idea by hand.
      if (Math.abs(v) < 10000) return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, en ? ',' : '.');
      const units = en ? [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] : [[1e9, ' T'], [1e6, ' Tr'], [1e3, ' N']];
      const [d, u] = units.find(([d]) => Math.abs(v) >= d);
      const x = String(Math.round(v / d * 10) / 10);
      return (en ? x : x.replace('.', ',')) + u;
    }
  },
};
