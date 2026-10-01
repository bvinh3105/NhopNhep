// Cloudflare Pages Function — cấp "vé liên kết" cho game Cơm Tấm Bà Thảo
// (https://com-tam-ba-thao.bachvinhtran.workers.dev/).
//
// Người dùng Nhóp Nhép đang đăng nhập bấm "Cho phép liên kết" (js/ctbt.js) → app gọi
// POST /api/game-link kèm token PocketBase (Authorization). Function hỏi PB token còn
// hợp lệ không (auth-refresh) rồi ký 1 vé HMAC-SHA256 bằng GAME_LINK_SECRET:
//   v1.<payload base64url>.<chữ ký base64url>, payload { u: id user, n: tên, iat, exp, aud: 'ctbt' }
// Game cầm vé để:
//  * lưu tiến trình chơi lên Cloudflare D1 của game (Worker game tự kiểm chữ ký, không cần PB);
//  * đăng check-in dưới tên chính người dùng (game-checkin.js kiểm chữ ký).
// Token PocketBase không bao giờ đưa cho game. Vé hết hạn sau 180 ngày; huỷ liên kết trong game = xoá vé.
//
// Env (Cloudflare Pages → Settings → Variables, loại Secret):
//   GAME_LINK_SECRET   chuỗi ngẫu nhiên ≥ 32 ký tự, GIỐNG HỆT secret cùng tên ở Worker com-tam-ba-thao
//   NN_GAME_BOT_USER   (đã có) id tài khoản chung "Bà Thảo" — KHÔNG cấp vé cho tài khoản này
// PB_URL đọc từ /backend.json (watchdog cập nhật mỗi lần đổi tunnel) nên file này không cần
// nằm trong $pagesFunctionsWithPbUrl của watchdog.

const PB_FALLBACK = 'https://sales-themes-nevada-forth.trycloudflare.com';
const SITE = 'https://nhopnhep.pages.dev';
const SITE_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?nhopnhep\.pages\.dev$/;
const DEV_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const LINK_DAYS = 180;
const BOT_USER_DEFAULT = 'p1b99ipcit1kskm';   // tài khoản chung "Bà Thảo" (dự phòng khi thiếu env)

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function pbUrl(context) {
  try {
    const r = await context.env.ASSETS.fetch(new URL('/backend.json', context.request.url));
    if (r.ok) {
      const j = await r.json();
      if (typeof j.url === 'string' && /^https:\/\/[a-z0-9.-]+$/i.test(j.url)) return j.url;
    }
  } catch (_) { /* dùng PB_FALLBACK */ }
  return PB_FALLBACK;
}

// ---- vé liên kết (giữ khớp với game-checkin.js và worker/index.js của game) ----
const enc = new TextEncoder();
function b64u(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
async function signLink(payload, secret) {
  const p = b64u(enc.encode(JSON.stringify(payload)));
  return `v1.${p}.${await hmac(secret, `v1.${p}`)}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const t0 = Date.now();
  const log = (status, note) => console.log(JSON.stringify({ ev: 'api_call', ep: 'game-link', status, note, ms: Date.now() - t0 }));

  const origin = request.headers.get('Origin') || '';
  if (!(SITE_ORIGIN_RE.test(origin) || DEV_ORIGIN_RE.test(origin))) {
    log(403, 'origin');
    return json(403, { ok: false, message: 'Chỉ cấp vé liên kết từ chính app Nhóp Nhép.' });
  }
  const secret = env.GAME_LINK_SECRET || '';
  if (secret.length < 32) {
    log(500, 'not_configured');
    return json(500, { ok: false, message: 'Nhóp Nhép chưa cấu hình xong liên kết game.' });
  }
  const auth = request.headers.get('Authorization') || '';
  if (!auth || auth.length > 4096) {
    log(401, 'no_auth');
    return json(401, { ok: false, message: 'Bạn cần đăng nhập Nhóp Nhép trước nha.' });
  }

  let record;
  try {
    const PB = await pbUrl(context);
    const r = await fetch(`${PB}/api/collections/users/auth-refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404) {
      log(401, `pb_${r.status}`);
      return json(401, { ok: false, message: 'Phiên đăng nhập hết hạn, đăng nhập lại nha.' });
    }
    if (!r.ok) throw new Error(`pb_${r.status}`);
    record = (await r.json()).record;
  } catch (e) {
    log(502, String(e && e.message || e).slice(0, 60));
    return json(502, { ok: false, message: 'Không kết nối được máy chủ Nhóp Nhép, thử lại sau nha.' });
  }
  if (!record || !/^[a-z0-9]{15}$/.test(record.id || '')) {
    log(502, 'bad_record');
    return json(502, { ok: false, message: 'Không đọc được tài khoản, thử lại sau nha.' });
  }

  // Không ai đăng check-in qua nick Bà Thảo: tài khoản chung không được liên kết với game
  if (record.id === (env.NN_GAME_BOT_USER || BOT_USER_DEFAULT)) {
    log(403, 'bot_account');
    return json(403, { ok: false, message: 'Tài khoản Bà Thảo là tài khoản chung của quán, không liên kết với game được.' });
  }

  const name = String(record.name || 'Bạn Nhóp Nhép').replace(/[<>"'`\\]/g, '').trim().slice(0, 40) || 'Bạn Nhóp Nhép';
  const now = Math.floor(Date.now() / 1000);
  const exp = now + LINK_DAYS * 86400;
  const token = await signLink({ u: record.id, n: name, iat: now, exp, aud: 'ctbt' }, secret);
  log(200, 'issued');
  return json(200, { ok: true, token, name, exp, site: SITE });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
