// Cloudflare Pages Function — sends a Web Push notification when someone
// follows a user. Called by the client right after a successful "follow"
// (friends-list update) — NOT triggered from PocketBase itself, since
// PocketBase's JS hook runtime has no npm/crypto-library access and hand-
// rolling RFC 8291 encryption there would be far harder to maintain than
// here, where the full Workers Web Crypto API (crypto.subtle) is available.
//
// Zero npm dependencies by design (see PROJECT_HANDOFF / this feature's
// design notes) — every piece of the Web Push protocol below (VAPID JWT
// signing, RFC 8291 payload encryption) is implemented directly against
// Web Crypto, not the `web-push` npm package, so this never needs
// Cloudflare's build pipeline to run `npm install` — same zero-build-step
// model as every other file in functions/api/.
//
// AUTH MODEL:
//   - "Is this really a follow?" check: reads the follower's OWN user
//     record via the now-public users endpoint (no auth needed — see
//     users.viewRule opened to "" for the anonymity fix) and confirms
//     `followedUserId` is actually in their `friends` list. Prevents a
//     bare POST from triggering a push for a relationship that doesn't
//     exist; does NOT fully prevent replay-spam of an EXISTING real follow
//     pair — accepted as a known v1 limitation (a push isn't a security
//     boundary, just a nuisance risk if ever scripted).
//   - Reading the FOLLOWED user's push_subscriptions needs elevated
//     access: push_subscriptions.listRule is "user = @request.auth.id"
//     (deliberately private, unlike users/restaurants), so a plain
//     unauthenticated call here would see zero rows. This Function
//     authenticates once as a PocketBase superuser (PB_ADMIN_EMAIL/
//     PB_ADMIN_PASSWORD, CF Pages secrets — set via `wrangler pages
//     secret put`, never in chat/code) to do that one cross-user read.
//
// Tunnel URL — same watchdog-patched constant as every other Function.

const PB_URL = 'https://operation-consultation-floating-cigarette.trycloudflare.com';
const VAPID_PUBLIC_KEY = 'BPSe1NDXoXEtvYH86qYexkNLS9gii_oBUNqDCzRO9ENmKZ2BsAXHsU1c3cDTXgzu-BqFKIPK0UHTgF76VpKXTLY';
const VAPID_SUBJECT = 'mailto:bachvinhtran@gmail.com'; // required by RFC 8292 — contact for push-service abuse reports

// ── base64url helpers (Workers has no atob/btoa Buffer shortcuts for raw bytes) ──
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// ── VAPID (RFC 8292): ES256 JWT signed with our own private key ────────
async function buildVapidHeader(audienceOrigin, privateJwk) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audienceOrigin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // 12h, well under RFC's 24h cap
    sub: VAPID_SUBJECT,
  };
  const enc = (obj) => bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc(header)}.${enc(payload)}`;

  const key = await crypto.subtle.importKey(
    'jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  // Web Crypto returns the raw r||s signature (64 bytes) — exactly the
  // format JWT ES256 wants, no DER re-encoding needed (unlike Node's
  // crypto.sign, which defaults to DER).
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${bytesToB64url(new Uint8Array(sig))}`;
  return `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`;
}

// ── RFC 8291: aes128gcm payload encryption ──────────────────────────────
async function encryptPayload(plaintextBytes, receiverPublicKeyB64, authSecretB64) {
  const uaPublic = b64urlToBytes(receiverPublicKeyB64); // subscription.keys.p256dh — 65-byte raw EC point
  const authSecret = b64urlToBytes(authSecretB64);       // subscription.keys.auth — 16 bytes

  // Ephemeral ECDH keypair for THIS message only ("as" = application server).
  const asKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));

  const uaPublicKey = await crypto.subtle.importKey(
    'raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256)
  );

  const hmac = async (keyBytes, dataBytes) => {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
  };

  // Step 1 — combine ECDH output with the subscription's auth secret into
  // a single IKM for the next step ("PRK_key" / "IKM" per RFC 8291 §3.4).
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'), uaPublic, asPublicRaw
  );
  const ikm = await hmac(prkKey, concatBytes(keyInfo, new Uint8Array([0x01])));

  // Step 2 — standard HKDF (RFC 8188) over that IKM, salted with a fresh
  // random 16-byte salt, to get the actual AES key + nonce for THIS record.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concatBytes(new TextEncoder().encode('Content-Encoding: aes128gcm\0'), new Uint8Array([0x01])))).slice(0, 16);
  const nonce = (await hmac(prk, concatBytes(new TextEncoder().encode('Content-Encoding: nonce\0'), new Uint8Array([0x01])))).slice(0, 12);

  // Single-record body per RFC 8188: plaintext + 0x02 delimiter, no padding.
  const record = concatBytes(plaintextBytes, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, ciphertext.length, false);
  const header = concatBytes(salt, recordSize, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concatBytes(header, ciphertext);
}

async function sendPush(subscription, payloadObj, privateJwk) {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const [vapidHeader, body] = await Promise.all([
    buildVapidHeader(audience, privateJwk),
    encryptPayload(new TextEncoder().encode(JSON.stringify(payloadObj)), subscription.p256dh, subscription.auth),
  ]);
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidHeader,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const t0 = Date.now();
  const apiLog = (status, note) => console.log(JSON.stringify({ ev: 'api_call', ep: 'notify-follow', status, note, ms: Date.now() - t0 }));

  let body;
  try { body = await request.json(); } catch (_) { apiLog(400, 'bad_json'); return json({ ok: false }, 400); }
  const { followerUserId, followedUserId } = body || {};
  const idRe = /^[a-z0-9]{15}$/;
  if (!idRe.test(followerUserId || '') || !idRe.test(followedUserId || '')) {
    apiLog(400, 'bad_ids'); return json({ ok: false }, 400);
  }

  if (!env.PB_ADMIN_EMAIL || !env.PB_ADMIN_PASSWORD || !env.VAPID_PRIVATE_KEY_JWK) {
    // Misconfigured deploy — fail silently from the caller's POV (this is
    // fire-and-forget from the follow button, never something worth
    // surfacing an error toast for) but log loudly for us.
    apiLog(500, 'not_configured'); return json({ ok: false, degraded: true });
  }

  try {
    // 1) Verify this is a REAL follow — public read, no auth needed.
    const followerRes = await fetch(`${PB_URL}/api/collections/users/records/${followerUserId}`, { signal: AbortSignal.timeout(6000) });
    if (!followerRes.ok) { apiLog(404, 'follower_not_found'); return json({ ok: false }, 404); }
    const follower = await followerRes.json();
    const friendIds = (follower.friends || []);
    if (!friendIds.includes(followedUserId)) { apiLog(400, 'not_a_follow'); return json({ ok: false }, 400); }

    // 2) Admin auth — needed only to read the FOLLOWED user's private
    // push_subscriptions rows (see file header).
    const authRes = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: env.PB_ADMIN_EMAIL, password: env.PB_ADMIN_PASSWORD }),
      signal: AbortSignal.timeout(6000),
    });
    if (!authRes.ok) { apiLog(502, 'admin_auth_failed'); return json({ ok: false, degraded: true }); }
    const { token: adminToken } = await authRes.json();

    // 3) Look up the followed user's subscriptions.
    const filter = encodeURIComponent(`user="${followedUserId}"`);
    const subsRes = await fetch(`${PB_URL}/api/collections/push_subscriptions/records?perPage=20&filter=${filter}`, {
      headers: { Authorization: adminToken },
      signal: AbortSignal.timeout(6000),
    });
    if (!subsRes.ok) { apiLog(502, 'subs_fetch_failed'); return json({ ok: false, degraded: true }); }
    const subsData = await subsRes.json();
    const subs = subsData.items || [];
    if (!subs.length) { apiLog(200, 'no_subscriptions'); return json({ ok: true, sent: 0 }); }

    const privateJwk = JSON.parse(env.VAPID_PRIVATE_KEY_JWK);
    const payload = {
      title: 'Nhóp Nhép',
      body: `${follower.name || 'Ai đó'} vừa theo dõi bạn`,
      url: '/',
      tag: `follow-${followerUserId}`,
    };

    let sent = 0;
    for (const sub of subs) {
      try {
        const res = await sendPush(sub, payload, privateJwk);
        if (res.ok) {
          sent++;
        } else if (res.status === 404 || res.status === 410) {
          // Push service says this endpoint is gone — clean it up so we
          // stop trying it every time this user gets a new follower.
          context.waitUntil(
            fetch(`${PB_URL}/api/collections/push_subscriptions/records/${sub.id}`, {
              method: 'DELETE', headers: { Authorization: adminToken },
            }).catch(() => {})
          );
        }
      } catch (_) { /* one dead subscription shouldn't stop the others */ }
    }
    apiLog(200, `sent:${sent}/${subs.length}`);
    return json({ ok: true, sent });
  } catch (e) {
    apiLog(502, `error:${e.message}`);
    return json({ ok: false, degraded: true });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
