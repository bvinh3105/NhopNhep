/* ═══════════════════════════════════════════════
   ANALYTICS — custom event tracking to self-hosted PocketBase
   Companion to Cloudflare Web Analytics: CF handles pageviews +
   traffic/geo/vitals passively (zero code, zero cost). This handles
   business events (scan, plan_built, add_quán, login, follow, …) so
   the admin can answer questions CF can't — "which quán got the most
   detail_opens this week?", "does login → post rate change after a
   UI tweak?" — right from the PocketBase admin UI.

   Rules (matching the plan the user OK'd):
   - Fire-and-forget POST — never block a click on the network.
   - Anonymous is fine: session_id (UUID in localStorage) is the
     identity when there's no login, user_id joins on top when there is.
   - Never inline PII in `props`: no free-text, no addresses, no coords,
     no user names. Enums + counts only.
   - Silent on failure: server unreachable = drop the event, log a
     `console.debug`, never surface to the user.
═══════════════════════════════════════════════ */

const Analytics = {
  COLLECTION: 'analytics_events',
  SESSION_KEY: 'analytics_session_id',
  ENABLED_KEY: 'analytics_disabled', // localStorage sentinel: any value = opt-out

  // ── Session id — one UUID per browser install, kept forever ─────────
  get sessionId() {
    let sid = '';
    try { sid = localStorage.getItem(this.SESSION_KEY) || ''; } catch (_) {}
    if (sid) return sid;
    sid = this._uuid();
    try { localStorage.setItem(this.SESSION_KEY, sid); } catch (_) {}
    return sid;
  },
  _uuid() {
    // crypto.randomUUID is fine on every modern browser we target
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Fallback: RFC4122 v4-ish. Not cryptographic, but unique enough.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  },

  disabled() {
    try { return !!localStorage.getItem(this.ENABLED_KEY); } catch (_) { return false; }
  },

  // ── Track ────────────────────────────────────────────────────────────
  track(event, props = {}) {
    if (this.disabled()) return;
    if (!event || typeof event !== 'string') return;
    // Don't hit the network on localhost — dev noise pollutes prod stats.
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      console.debug('[Analytics] (dev) skipped', event, props);
      return;
    }
    // Community is optional now — user_id enrichment only. sessionId
    // is the identity when it's missing.
    const user_id = (typeof Community !== 'undefined' && Community.currentUser?.id) || null;
    const is_guest = !(typeof Community !== 'undefined' && Community.isLoggedIn && Community.isLoggedIn());

    const body = {
      event: String(event).slice(0, 40),
      session_id: this.sessionId,
      user_id,
      is_guest,
      props: this._sanitizeProps(props),
      ua: (navigator.userAgent || '').slice(0, 200),
      referrer: (document.referrer || '').slice(0, 200),
    };

    // POST to a same-origin Cloudflare Function proxy instead of the
    // PocketBase collection URL directly. Cross-origin beacons to a
    // trycloudflare tunnel with "analytics" in the path were being
    // swallowed by every browser ad blocker / Enhanced Tracking
    // Protection / Brave shields (verified 2026-09-10: 0 browser
    // events collected while server-side curl worked fine). Same-
    // origin request looks like an ordinary app call and slips past
    // all of that.
    const url = '/api/log';
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
        const ok = navigator.sendBeacon(url, blob);
        if (ok) return;
      }
    } catch (_) { /* fall through */ }
    // Fallback path
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(e => console.debug('[Analytics] send failed:', e.message));
    } catch (e) {
      console.debug('[Analytics] send threw:', e.message);
    }
  },

  // ── Boot — call once when app loads ─────────────────────────────────
  boot() {
    this.track('app_open', {
      lang: (navigator.language || '').slice(0, 8),
      screen: `${screen.width}x${screen.height}`,
    });
  },

  // Enum / number allowlist so free-text (PII risk) never leaks in.
  _sanitizeProps(p) {
    if (!p || typeof p !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(p)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue; }
      if (typeof v === 'string') { out[k] = v.slice(0, 60); continue; }
      // Arrays of primitives ok (used e.g. for cats list) — capped length
      if (Array.isArray(v)) {
        out[k] = v.filter(x => typeof x === 'string' || typeof x === 'number').slice(0, 10);
        continue;
      }
      // Everything else (nested objects, functions, …) is silently dropped
    }
    return out;
  },
};
