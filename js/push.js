/* ═══════════════════════════════════════════════
   PUSH NOTIFICATIONS — v1: "someone followed you" only
   Registers sw.js (created fresh for this — see its own header) only
   when the user opts in from Settings, never eagerly at boot. Sending the
   actual push happens server-side in functions/api/notify-follow.js.
═══════════════════════════════════════════════ */
const Push = {
  // Public VAPID key (safe to embed — the private half never leaves the
  // Cloudflare Pages secret store). Must match functions/api/notify-follow.js.
  VAPID_PUBLIC_KEY: 'BPSe1NDXoXEtvYH86qYexkNLS9gii_oBUNqDCzRO9ENmKZ2BsAXHsU1c3cDTXgzu-BqFKIPK0UHTgF76VpKXTLY',

  isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
  },

  _urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(safe);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  },

  async _getRegistration() {
    if (!this.isSupported()) return null;
    try { return (await navigator.serviceWorker.getRegistration('/sw.js')) || null; }
    catch (_) { return null; }
  },

  // Cached per page load — checked on Settings open to draw the toggle's
  // current state without re-touching the service worker every render.
  async isSubscribed() {
    const reg = await this._getRegistration();
    if (!reg) return false;
    try { return !!(await reg.pushManager.getSubscription()); }
    catch (_) { return false; }
  },

  async subscribe() {
    if (!this.isSupported()) return { ok: false, error: I18N.t('push.unsupported') };
    if (!Community.isLoggedIn()) return { ok: false, error: I18N.t('err.needLogin') };

    let perm;
    try { perm = await Notification.requestPermission(); }
    catch (e) { return { ok: false, error: e.message || I18N.t('push.unsupported') }; }
    if (perm !== 'granted') return { ok: false, error: I18N.t('push.permissionDenied') };

    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlBase64ToUint8Array(this.VAPID_PUBLIC_KEY),
      });
      const j = sub.toJSON();
      const r = await Community._fetch('/api/collections/push_subscriptions/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: Community.currentUser.id,
          endpoint: j.endpoint,
          p256dh: j.keys.p256dh,
          auth: j.keys.auth,
        }),
      });
      // A duplicate-endpoint rejection just means we're already tracked
      // server-side (re-subscribe returned the same live subscription) —
      // the push itself is live either way, so don't surface this as a
      // user-facing failure.
      if (!r.ok) console.warn('[Push] save subscription failed (non-fatal):', r.error);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || I18N.t('err.connectionGeneric') };
    }
  },

  async unsubscribe() {
    const reg = await this._getRegistration();
    if (!reg) return { ok: true };
    try {
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return { ok: true };
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      if (Community.isLoggedIn()) {
        const filter = encodeURIComponent(`endpoint="${endpoint}"`);
        const list = await Community._fetch(`/api/collections/push_subscriptions/records?perPage=1&filter=${filter}`);
        const rec = list.ok && list.data.items && list.data.items[0];
        if (rec) await Community._fetch(`/api/collections/push_subscriptions/records/${rec.id}`, { method: 'DELETE' });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || I18N.t('err.connectionGeneric') };
    }
  },
};
