// Cloudflare Pages Function — check-in từ game "Cơm Tấm Bà Thảo"
// (https://com-tam-ba-thao.bachvinhtran.workers.dev/ — trước 2026-10-01 là bvinh3105.github.io) lên Nhóp Nhép,
// vào quán "Cơm Tấm Bà Thảo".
// 2026-10-01: đăng dưới TÀI KHOẢN CỦA CHÍNH NGƯỜI CHƠI — game phải liên kết Nhóp Nhép trước
// (vé liên kết do functions/api/game-link.js ký, gửi trong Authorization: Bearer <vé>).
// Chơi game không cần tài khoản; chỉ đăng lên Nhóp Nhép mới cần. Bài cũ của tài khoản chung
// "Bà Thảo" (NN_GAME_BOT_USER) vẫn giữ nguyên.
//
// Function này là cổng duy nhất từ game nên phải tự chống lạm dụng:
//  * Tắt mặc định: chỉ chạy khi env NN_GAME_CHECKIN = 'on' (công tắc tắt khẩn cấp).
//  * Turnstile bắt buộc (action 'game_checkin', hostname của game).
//  * KHÔNG nhận chữ tự do: note do server dựng từ câu mẫu + số liệu đã kiểm tra.
//  * Ảnh: chỉ WebP/JPEG, <= 400KB, đúng 1080x1440 (khung ảnh dọc 3:4 game vẽ ra).
//  * Giới hạn: mỗi tài khoản 3 bài/24h, mỗi IP 6 bài/24h, toàn hệ thống NN_GAME_DAILY (mặc định 100)/24h,
//    đếm thẳng trên PocketBase (trường ẩn game_ip = sha256 của IP) nên đúng
//    trên mọi isolate; thêm chặn dồn dập trong isolate.
//  * Bài game có source = 'game'; bị báo cáo 1 lần là tự ẩn (pb_hooks/nn_game_checkins.pb.js).
//
// Env (Cloudflare Pages → Settings → Variables):
//   NN_GAME_CHECKIN      'on' để mở cổng
//   GAME_LINK_SECRET     secret dùng chung với game-link.js + Worker game (kiểm vé liên kết)
//   NN_GAME_BOT_USER     id user "Bà Thảo" (bài cũ; không còn dùng để đăng)
//   NN_GAME_QUAN         id quán "Cơm Tấm Bà Thảo" (không phải bí mật)
//   PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD   superuser PB (đã có, notify-follow.js dùng chung)
//   GAME_TURNSTILE_SECRET (hoặc dùng chung TURNSTILE_SECRET nếu thêm hostname game vào widget cũ)
//   NN_GAME_DAILY        tuỳ chọn, trần bài/24h toàn hệ thống (mặc định 100)
//
// PB_URL phải được watchdog đồng bộ như các Function khác: thêm
// "functions\api\game-checkin.js" vào $pagesFunctionsWithPbUrl trong Bat-TOAN-BO*.ps1.

const PB_URL = 'https://conflict-kernel-eye-that.trycloudflare.com';

const TURNSTILE_ACTION = 'game_checkin';
// 2026-10-01: game chuyển sang Cloudflare Workers (repo game private, GitHub Pages tắt); giữ github.io phòng khi bật lại
const EXPECTED_HOSTNAMES = new Set(['com-tam-ba-thao.bachvinhtran.workers.dev', 'bvinh3105.github.io', 'localhost', '127.0.0.1']);
const ALLOWED_ORIGINS = new Set(['https://com-tam-ba-thao.bachvinhtran.workers.dev', 'https://bvinh3105.github.io']);
const DEV_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const SITE = 'https://nhopnhep.pages.dev';

const QUAN_NAME = 'Cơm Tấm Bà Thảo';
const QUAN_EMOJI = '🍚';
const MAX_PHOTO = 400 * 1024;
const PHOTO_W = 1080;
const PHOTO_H = 1440;
const USER_DAILY = 3;
const BOT_USER_DEFAULT = 'p1b99ipcit1kskm';   // tài khoản chung "Bà Thảo" (dự phòng khi thiếu env)
const IP_DAILY = 6;
const DEFAULT_DAILY = 100;

const WEEKDAYS = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
// Khách quen trong game (game-data.js) — chỉ nhận đúng các key này
const WHO = {
  anh_minh: 'Anh Minh Văn Phòng',
  be_thao: 'Bé Thảo Học Sinh',
  chu_tu: 'Chú Tư Xe Ôm',
  co_lan: 'Cô Lan Đi Chợ Sớm',
  ong_bay: 'Ông Bảy Bán Vé Số',
  anh_shipper: 'Anh Đức Shipper',
};

// Giữ khớp với NN_CAPTIONS trong js/nhopnhep.js của game
const CAPTIONS = [
  d => `${d.weekday} ở quầy Bà Thảo: bán ${d.served} đĩa, ${d.perfect} đĩa chuẩn 🌟`,
  d => d.net > 0 ? `Sườn nướng than thơm cả xóm! ${d.weekday} lãi ${d.netText} 💰` : 'Sườn nướng than thơm cả xóm! Mai Bà Thảo lại mở hàng nha 🔥',
  d => d.whoName ? `Đĩa đẹp nhất hôm nay là của ${d.whoName} 😍` : 'Đĩa đẹp nhất hôm nay đây nè 😍',
];

// Cùng công thức sao với game
function starsFor(served, perfect, net) {
  if (served === 0) return 3;
  return Math.max(1, Math.min(5, Math.round(1 + (perfect / served) * 3 + (net >= 30000 ? 1 : 0))));
}

// 85000 -> "85k", 1250000 -> "1.250k" (giống formatK của game, locale vi-VN)
function formatK(n) {
  const k = Math.round(Math.abs(n) / 1000);
  return String(k).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'k';
}

function corsHeaders(origin) {
  if (!origin || !(ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN_RE.test(origin))) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(status, body, origin, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin), ...extra },
  });
}

function intField(form, name, min, max) {
  const raw = form.get(name);
  if (typeof raw !== 'string' || !/^-?\d{1,9}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : null;
}

// Kích thước ảnh đọc từ header file (không tin Content-Type của client)
function imageInfo(buf) {
  const b = new Uint8Array(buf);
  const ascii = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { type: 'image/webp', w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
    }
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { type: 'image/webp', w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      return { type: 'image/webp', w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { o += m === 0xff ? 1 : 2; continue; }
      const len = (b[o + 2] << 8) | b[o + 3];
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        return { type: 'image/jpeg', h: (b[o + 5] << 8) | b[o + 6], w: (b[o + 7] << 8) | b[o + 8] };
      }
      if (m === 0xda || len < 2) return null;
      o += 2 + len;
    }
  }
  return null;
}

// ---- vé liên kết (giữ khớp với game-link.js và worker/index.js của game) ----
const enc = new TextEncoder();
function b64u(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(s) {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
async function verifyLink(header, secret) {
  const m = /^Bearer (v1\.([A-Za-z0-9_-]{10,800})\.([A-Za-z0-9_-]{20,100}))$/.exec(header || '');
  if (!m || !secret) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = enc.encode(b64u(await crypto.subtle.sign('HMAC', key, enc.encode(`v1.${m[2]}`))));
  const got = enc.encode(m[3]);
  if (want.length !== got.length || !crypto.subtle.timingSafeEqual(want, got)) return null;
  let p;
  try { p = JSON.parse(new TextDecoder().decode(b64uDecode(m[2]))); } catch (_) { return null; }
  if (!p || p.aud !== 'ctbt' || !/^[a-z0-9]{15}$/.test(p.u || '') || !(p.exp > Date.now() / 1000)) return null;
  return { uid: p.u, name: String(p.n || '').slice(0, 40) };
}

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// IPv6 gộp theo /64 (một máy thường có cả dải), IPv4 giữ nguyên
function ipBucket(ip) {
  if (!ip.includes(':')) return ip;
  return ip.split(':').slice(0, 4).join(':') + '::/64';
}

// Chặn dồn dập trong isolate: 5 lần gửi / 10 phút / IP (lớp rẻ trước khi gọi PB)
const burst = new Map();
function overBurst(key, now = Date.now()) {
  const win = 10 * 60 * 1000;
  const e = burst.get(key);
  if (!e || now - e.t > win) { burst.set(key, { t: now, n: 1 }); return false; }
  e.n++;
  if (burst.size > 5000) burst.clear();
  return e.n > 5;
}

// Token superuser, cache trong isolate
let suToken = '';
let suUntil = 0;
let suRetryAt = 0;
function tokenExpiry(token) {
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (p.exp || 0) * 1000;
  } catch (_) { return 0; }
}
async function superuser(env, signal) {
  const now = Date.now();
  if (suToken && now < suUntil) return suToken;
  if (!env.PB_ADMIN_EMAIL || !env.PB_ADMIN_PASSWORD) throw new Error('no_admin_secret');
  if (now < suRetryAt) throw new Error('su_backoff');
  const r = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: env.PB_ADMIN_EMAIL, password: env.PB_ADMIN_PASSWORD }),
    signal,
  });
  if (!r.ok) { suRetryAt = now + 60000; throw new Error(`su_failed:${r.status}`); }
  const { token } = await r.json();
  suToken = token || '';
  const exp = tokenExpiry(suToken);
  suUntil = now + Math.max(0, Math.min(1800 * 1000, (exp ? exp - now : 0) - 60000));
  return suToken;
}

function pbTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

async function countCheckins(filter, token, signal) {
  const url = `${PB_URL}/api/collections/checkins/records?perPage=1&fields=id&filter=${encodeURIComponent(filter)}`;
  const r = await fetch(url, { headers: { Authorization: token }, signal });
  if (!r.ok) throw new Error(`count_${r.status}`);
  const d = await r.json();
  return Number(d.totalItems || 0);
}

export async function onRequestOptions({ request }) {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const ip = request.headers.get('CF-Connecting-IP') || '-';
  const t0 = Date.now();
  const log = (status, note) => console.log(JSON.stringify({ ev: 'api_call', ep: 'game-checkin', status, note, ms: Date.now() - t0 }));

  if (!(ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN_RE.test(origin))) {
    log(403, 'origin');
    return json(403, { ok: false, message: 'Chỉ nhận check-in từ game Cơm Tấm Bà Thảo.' }, origin);
  }
  if (env.NN_GAME_CHECKIN !== 'on') {
    log(503, 'off');
    return json(503, { ok: false, message: 'Nhóp Nhép tạm đóng cổng nhận check-in từ game.' }, origin);
  }
  const secret = env.GAME_TURNSTILE_SECRET || env.TURNSTILE_SECRET;
  if (!env.NN_GAME_QUAN || !secret || (env.GAME_LINK_SECRET || '').length < 32) {
    log(500, 'not_configured');
    return json(500, { ok: false, message: 'Nhóp Nhép chưa cấu hình xong cổng check-in từ game.' }, origin);
  }
  if (!/^[a-z0-9]{15}$/.test(env.NN_GAME_QUAN)) {
    log(500, 'bad_ids');
    return json(500, { ok: false, message: 'Nhóp Nhép chưa cấu hình xong cổng check-in từ game.' }, origin);
  }

  const link = await verifyLink(request.headers.get('Authorization'), env.GAME_LINK_SECRET);
  if (!link) {
    log(401, 'no_link');
    return json(401, { ok: false, needLink: true, message: 'Cần liên kết tài khoản Nhóp Nhép trước khi đăng nha.' }, origin);
  }
  // Không ai đăng check-in qua nick Bà Thảo (tài khoản chung của quán)
  if (link.uid === (env.NN_GAME_BOT_USER || BOT_USER_DEFAULT)) {
    log(403, 'bot_account');
    return json(403, { ok: false, needLink: true, message: 'Không đăng check-in bằng tài khoản Bà Thảo được, liên kết tài khoản của bạn nha.' }, origin);
  }

  const bucket = ipBucket(ip);
  if (overBurst(bucket)) {
    log(429, 'burst');
    return json(429, { ok: false, message: 'Bà Thảo đăng hơi dồn dập rồi, nghỉ chút rồi thử lại nha.' }, origin, { 'Retry-After': '600' });
  }

  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_PHOTO + 64 * 1024) {
    log(413, 'too_big');
    return json(413, { ok: false, message: 'Ảnh check-in quá nặng.' }, origin);
  }
  let form;
  try {
    form = await request.formData();
  } catch (_) {
    log(400, 'form');
    return json(400, { ok: false, message: 'Dữ liệu check-in không hợp lệ.' }, origin);
  }

  // ---- số liệu (không nhận chữ tự do) ----
  const weekday = form.get('weekday');
  const served = intField(form, 'served', 0, 40);
  const perfect = intField(form, 'perfect', 0, 40);
  const net = intField(form, 'net', -5000000, 5000000);
  const caption = intField(form, 'caption', 0, CAPTIONS.length - 1);
  const whoRaw = form.get('who');
  const who = typeof whoRaw === 'string' && whoRaw ? whoRaw : '';
  if (!WEEKDAYS.includes(weekday) || served === null || perfect === null || perfect > served ||
      net === null || caption === null || (who && !Object.prototype.hasOwnProperty.call(WHO, who))) {
    log(400, 'fields');
    return json(400, { ok: false, message: 'Số liệu check-in không hợp lệ.' }, origin);
  }

  // ---- ảnh ----
  const photo = form.get('photo');
  if (!photo || typeof photo === 'string' || photo.size > MAX_PHOTO || photo.size < 1000) {
    log(400, 'photo_size');
    return json(400, { ok: false, message: 'Ảnh check-in không hợp lệ.' }, origin);
  }
  const buf = await photo.arrayBuffer();
  const info = imageInfo(buf);
  if (!info || info.w !== PHOTO_W || info.h !== PHOTO_H) {
    log(400, 'photo_kind');
    return json(400, { ok: false, message: 'Ảnh check-in không hợp lệ.' }, origin);
  }

  // ---- Turnstile ----
  const token = form.get('cf-turnstile-response');
  if (typeof token !== 'string' || !token || token.length > 2048) {
    log(403, 'turnstile_missing');
    return json(403, { ok: false, message: 'Xác minh chống bot chưa xong, thử lại nha.' }, origin);
  }
  let verify;
  try {
    const vr = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    if (!vr.ok) throw new Error(`siteverify ${vr.status}`);
    verify = await vr.json();
  } catch (e) {
    log(502, 'turnstile_unreachable');
    return json(502, { ok: false, message: 'Không xác minh được, thử lại sau nha.' }, origin);
  }
  if (!verify.success || verify.action !== TURNSTILE_ACTION || !EXPECTED_HOSTNAMES.has(verify.hostname)) {
    log(403, `turnstile_fail:action=${verify.action},host=${verify.hostname}`);
    return json(403, { ok: false, message: 'Xác minh chống bot không qua, thử lại nha.' }, origin);
  }

  const signal = AbortSignal.timeout(9000);
  try {
    const su = await superuser(env, signal);
    const since = pbTime(Date.now() - 24 * 3600 * 1000);
    const ipHash = (await sha256Hex(`nhopnhep-game|${bucket}`)).slice(0, 32);
    const [mine, fromIp, all] = await Promise.all([
      countCheckins(`user = "${link.uid}" && source = "game" && created >= "${since}"`, su, signal),
      countCheckins(`game_ip = "${ipHash}" && source = "game" && created >= "${since}"`, su, signal),
      countCheckins(`source = "game" && created >= "${since}"`, su, signal),
    ]);
    if (mine >= USER_DAILY || fromIp >= IP_DAILY) {
      log(429, mine >= USER_DAILY ? 'user_daily' : 'ip_daily');
      return json(429, { ok: false, message: `Mỗi ngày chỉ đăng được ${USER_DAILY} check-in từ game thôi nha.` }, origin);
    }
    const daily = Number(env.NN_GAME_DAILY) > 0 ? Number(env.NN_GAME_DAILY) : DEFAULT_DAILY;
    if (all >= daily) {
      log(429, 'global_daily');
      return json(429, { ok: false, message: 'Hôm nay trang quán Bà Thảo nhận đủ check-in rồi, mai quay lại nha.' }, origin);
    }

    const d = { weekday, served, perfect, net, netText: formatK(net), whoName: who ? WHO[who] : '' };
    const body = new FormData();
    body.append('user', link.uid);
    body.append('restaurant', env.NN_GAME_QUAN);
    body.append('restaurant_name', QUAN_NAME);
    body.append('restaurant_emoji', QUAN_EMOJI);
    body.append('rating', String(starsFor(served, perfect, net)));
    body.append('note', CAPTIONS[caption](d).slice(0, 200));
    body.append('is_shared', 'true');
    body.append('source', 'game');
    body.append('game_ip', ipHash);
    const ext = info.type === 'image/webp' ? 'webp' : 'jpg';
    body.append('photo', new Blob([buf], { type: info.type }), `ba-thao.${ext}`);
    const r = await fetch(`${PB_URL}/api/collections/checkins/records?fields=id`, {
      method: 'POST',
      headers: { Authorization: su },
      body,
      signal,
    });
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) suToken = '';
      log(502, `pb_create_${r.status}`);
      return json(502, { ok: false, message: 'Nhóp Nhép đang bận, thử lại sau nha.' }, origin);
    }
    const rec = await r.json();
    log(200, 'created');
    return json(200, { ok: true, id: rec.id, url: `${SITE}/?checkin=${rec.id}` }, origin);
  } catch (e) {
    suToken = '';
    log(502, `pb:${String(e && e.message || e).slice(0, 60)}`);
    return json(502, { ok: false, message: 'Nhóp Nhép đang bận, thử lại sau nha.' }, origin);
  }
}
