/* ═══════════════════════════════════════════════
   ICON SYSTEM — SVG sprite (icons/sprite.svg), one <symbol> per icon,
   referenced via <use>. Replaces the emoji this app used to render
   directly (Windows/Android/iOS/each browser draws emoji differently —
   see the icon inventory this was generated from). svgIcon(name) returns
   ready-to-insert markup; .icon in styles.css handles sizing (1em, scales
   with font-size like the emoji did) and color (currentColor, so a button
   with a colored background tints its icon exactly like its text).
   Named svgIcon() and not icon() — several functions in controllers.js/
   map.js already use `icon` as a local variable name (a DOM element or an
   L.divIcon), which would shadow a global icon() inside those scopes.

   width/height="20" are a hard fallback, not the real size: .icon in
   styles.css overrides them with 1em (scales with font-size, like the
   emoji did) whenever the stylesheet is actually loaded. Without them, a
   stale-cached styles.css served alongside a fresh HTML/JS pair (e.g. a
   deploy landing mid-cache-window) leaves the <svg> with no size at all,
   and browsers fall back to the intrinsic replaced-element default of
   300×150px — every icon balloons to fill its button. Caught live
   2026-09-17 (chip buttons rendered as giant colored blocks).
═══════════════════════════════════════════════ */
function svgIcon(name, cls = '') {
  return `<svg class="icon${cls ? ' ' + cls : ''}" width="20" height="20"><use href="icons/sprite.svg#ic-${name}"></use></svg>`;
}

/* ═══════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════ */
// .label là getter đọc I18N.t(...) tại thời điểm truy cập (không phải giá
// trị cố định) — nên mọi nơi trong app đang gọi CATEGORIES[x].label tự
// động ra đúng ngôn ngữ hiện tại, kể cả sau khi người dùng đổi ngôn ngữ
// giữa chừng, không cần sửa lại từng chỗ gọi. .icon cũng là getter (trả
// markup <svg> sẵn dùng) theo đúng lý do tương tự — mọi ${cat.icon} hiện
// có tự động ra icon mới, không cần sửa từng chỗ gọi.
const CATEGORIES = {
  restaurant: { get label(){ return I18N.t('catLabel.restaurant'); }, get icon(){ return svgIcon('cat-nhahang'); }, color:'#B92626', dwell:60 },
  street:     { get label(){ return I18N.t('catLabel.street'); },     get icon(){ return svgIcon('cat-viahe'); },   color:'#E8843C', dwell:30 },
  snack:      { get label(){ return I18N.t('catLabel.snack'); },      get icon(){ return svgIcon('cat-anvat'); },   color:'#D64B7A', dwell:20 },
  cafe:       { get label(){ return I18N.t('catLabel.cafe'); },       get icon(){ return svgIcon('cat-caphe'); },   color:'#7A4E2F', dwell:45 },
};

// Tên icon avatar khớp file icons-svg gốc — dùng food-* cho món đã có icon
// riêng (phở, pizza, sushi…) thay vì vẽ lại. AVATAR_LEGACY_EMOJI map ngược
// lại để đọc đúng avatar_emoji cũ đã lưu trong PocketBase từ trước khi có
// icon (user cũ không phải chọn lại avatar).
const AVATARS = ['food-pho','food-pizza','avatar-burger','food-sushi','avatar-cake','avatar-donut','food-kem','avatar-salad','avatar-taco','avatar-shrimp','avatar-bento','food-lau','food-bun','avatar-dumpling','food-nuong','food-caphe','food-trasua','avatar-cocktail'];
const AVATAR_DEFAULT = 'food-pho';
const AVATAR_LEGACY_EMOJI = {
  '🍜':'food-pho','🍕':'food-pizza','🍔':'avatar-burger','🍣':'food-sushi','🍰':'avatar-cake',
  '🍩':'avatar-donut','🍦':'food-kem','🥗':'avatar-salad','🌮':'avatar-taco','🍤':'avatar-shrimp',
  '🍱':'avatar-bento','🥘':'food-lau','🍲':'food-bun','🥟':'avatar-dumpling','🍢':'food-nuong',
  '☕':'food-caphe','🧋':'food-trasua','🍹':'avatar-cocktail',
};
// avatar_emoji lưu trong PocketBase có thể là icon-name mới HOẶC emoji cũ
// (user đã có tài khoản từ trước bản icon này) — hàm này luôn trả về đúng
// markup hiển thị bất kể định dạng nào đang lưu.
function avatarIcon(stored) {
  if (!stored) return svgIcon(AVATAR_DEFAULT);
  if (AVATARS.includes(stored)) return svgIcon(stored);
  if (AVATAR_LEGACY_EMOJI[stored]) return svgIcon(AVATAR_LEGACY_EMOJI[stored]);
  return escapeHtml(stored); // giá trị lạ không nhận diện được — hiện nguyên văn thay vì vỡ layout
}
// Chuẩn hoá về đúng tên icon (không phải markup) — dùng khi GÁN vào
// State.profile.avatar (từ localStorage/PocketBase cũ) để phần so sánh
// "avatar nào đang được chọn" trong avatarPicker luôn khớp đúng, kể cả
// với tài khoản có avatar_emoji lưu từ trước khi có bộ icon này.
function normalizeAvatarName(stored) {
  if (AVATARS.includes(stored)) return stored;
  return AVATAR_LEGACY_EMOJI[stored] || AVATAR_DEFAULT;
}

/* ═══════════════════════════════════════════════
   DROPDOWN POSITIONING
   `.geocode-suggest` boxes (address search, friend search) live inside
   scrollable containers (home sheet, modal sheet). position:absolute
   there is fragile — the containing block's height can be stale the
   instant new content changes it, and mobile browsers reflow the layout
   viewport when the on-screen keyboard opens, both of which can leave the
   box floating far from its input. Compute position:fixed coordinates
   from the input's live bounding rect instead, and re-sync on scroll
   (capture:true catches scroll on any nested scrollable ancestor even
   though 'scroll' doesn't bubble) and resize.

   Gotcha that actually caused the original bug: position:fixed is NOT
   viewport-relative when an ancestor has a `transform` set — becomes the
   fixed containing block instead of the viewport per spec. Two different
   elements here have one: every .modal-sheet (the slide-up-open
   animation), AND <body> itself (`transform:translateZ(0)` on wide/
   desktop viewports, for the centered phone-frame look) — so moving the
   suggest box to be a child of <body> only escapes the first one. Use
   <html> instead, which has neither.
═══════════════════════════════════════════════ */
const DropdownPosition = {
  _pairs: [],
  register(input, suggest) {
    const root = document.documentElement;
    if (suggest.parentElement !== root) root.appendChild(suggest);
    this._pairs.push({ input, suggest });
  },
  reposition(input, suggest) {
    const r = input.getBoundingClientRect();
    const vh = window.innerHeight;
    const spaceBelow = vh - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const maxH = 280;

    suggest.style.setProperty('--go-left', `${r.left}px`);
    suggest.style.setProperty('--go-width', `${r.width}px`);

    if (spaceBelow >= 100 || spaceBelow >= spaceAbove) {
      suggest.style.setProperty('--go-top', `${r.bottom + 4}px`);
      suggest.style.setProperty('--go-max-h', `${Math.max(Math.min(maxH, spaceBelow), 80)}px`);
    } else {
      const h = Math.max(Math.min(maxH, spaceAbove), 80);
      suggest.style.setProperty('--go-top', `${r.top - h - 4}px`);
      suggest.style.setProperty('--go-max-h', `${h}px`);
    }
  },
  _syncShown() {
    this._pairs.forEach(({ input, suggest }) => {
      if (suggest.classList.contains('show')) this.reposition(input, suggest);
    });
  },
  init() {
    window.addEventListener('scroll', () => this._syncShown(), true);
    window.addEventListener('resize', () => this._syncShown());
  },
};

/* ═══════════════════════════════════════════════
   UTILITY FUNCTIONS
═══════════════════════════════════════════════ */
// Everything the app itself creates (own profile, "Quán của tôi") is
// trusted single-user data. Community content is written by OTHER real
// users and rendered via innerHTML in other people's browsers — escape it
// or a restaurant name like "<img onerror=...>" becomes stored XSS.
const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => _escMap[c]);
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const p1 = lat1 * Math.PI/180, p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1)*Math.PI/180, dl = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function fmtDist(m) { return m < 1000 ? Math.round(m)+'m' : (m/1000).toFixed(1)+'km'; }

// Google Maps link for a place. Gemini's coordinates AND its address are
// both unreliable (often the wrong district), so for AI results we search
// by NAME ONLY, centered on the USER's real location — Google then
// resolves the real listing near the user. For accurate sources (OSM /
// user-added) we can trust the place's own coords and address.
function gmapsUrl(r) {
  const name = (r && r.name) ? String(r.name).trim() : '';
  const uLat = (typeof State !== 'undefined' && typeof State.userLat === 'number') ? State.userLat : null;
  const uLng = (typeof State !== 'undefined' && typeof State.userLng === 'number') ? State.userLng : null;

  // Trustworthy map center: never Gemini's coords.
  let cLat = null, cLng = null;
  if (r && r._gemini) {
    cLat = uLat; cLng = uLng;                       // AI → center on the user
  } else if (typeof r?.lat === 'number') {
    cLat = r.lat; cLng = r.lng;                      // OSM/user → own coords
  } else { cLat = uLat; cLng = uLng; }

  if (name) {
    let q = name;
    if (!r._gemini && r.address) q += ' ' + r.address;   // only trust real addresses
    if (typeof cLat === 'number') {
      return `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${cLat},${cLng},15z`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  if (typeof cLat === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${cLat},${cLng}`;
  }
  return 'https://www.google.com/maps';
}

// Google Maps search for a raw text query (e.g. a partial name "coo"),
// centered on the user's real location so Google's own autocomplete
// resolves the nearby match (Coo.chan) even when our data can't.
function gmapsSearchUrl(query) {
  const q = String(query || '').trim();
  const uLat = (typeof State !== 'undefined' && typeof State.userLat === 'number') ? State.userLat : null;
  const uLng = (typeof State !== 'undefined' && typeof State.userLng === 'number') ? State.userLng : null;
  if (!q) return uLat != null ? `https://www.google.com/maps/@${uLat},${uLng},15z` : 'https://www.google.com/maps';
  if (uLat != null) return `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${uLat},${uLng},15z`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function fmtTime(min) {
  if (min < 60) return min+'p';
  return Math.floor(min/60)+'h'+(min%60?String(min%60).padStart(2,'0')+'p':'');
}

function travelMinutes(m) { return Math.max(3, Math.round(m/1000/25*60) + 3); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

let _toastTimer;
function showToast(msg, duration = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function addMinutes(baseDate, min) {
  const d = new Date(baseDate);
  d.setMinutes(d.getMinutes()+min);
  return d;
}

function fmtClock(d) {
  return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
}

function allRestaurants() {
  return [
    ...State.userRestaurants,
    ...State.osmRestaurants,
    ...State.communityRestaurants,
  ];
}

/* ═══════════════════════════════════════════════
   OPENING HOURS PARSER
   Parses common OSM opening_hours formats and
   returns current open/closed status.
═══════════════════════════════════════════════ */
const DAY_NAMES = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function parseOpeningHours(hoursStr) {
  if (!hoursStr) return null;
  const s = hoursStr.trim();

  // 24/7
  if (s === '24/7') {
    return { isOpen: true, label: I18N.t('openHours.always'), detail: '', raw: s };
  }

  const now = new Date();
  const currentDay = now.getDay(); // 0=Su
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const todayCode = DAY_NAMES[currentDay];

  // Parse day ranges like "Mo-Fr", "Mo-Su", "Mo,We,Fr"
  function expandDays(dayPart) {
    const days = new Set();
    const segments = dayPart.split(',');
    for (const seg of segments) {
      const trimmed = seg.trim();
      const rangeMatch = trimmed.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)$/);
      if (rangeMatch) {
        const start = DAY_NAMES.indexOf(rangeMatch[1]);
        const end = DAY_NAMES.indexOf(rangeMatch[2]);
        if (start >= 0 && end >= 0) {
          for (let i = start; ; i = (i+1) % 7) {
            days.add(DAY_NAMES[i]);
            if (i === end) break;
          }
        }
      } else if (DAY_NAMES.includes(trimmed)) {
        days.add(trimmed);
      }
    }
    return days;
  }

  // Parse time ranges like "07:00-22:00"
  function parseTimeRanges(timePart) {
    const ranges = [];
    const parts = timePart.split(',');
    for (const p of parts) {
      const m = p.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/);
      if (m) {
        ranges.push({
          openMin: parseInt(m[1]) * 60 + parseInt(m[2]),
          closeMin: parseInt(m[3]) * 60 + parseInt(m[4]),
        });
      }
    }
    return ranges;
  }

  // Try to parse semicolon-separated rules
  const rules = s.split(';').map(r => r.trim()).filter(Boolean);
  let matchedRanges = null;

  for (const rule of rules) {
    const dayTimeMatch = rule.match(/^([A-Za-z,\-\s]+)\s+(\d{1,2}:\d{2}.*)$/);
    if (dayTimeMatch) {
      const days = expandDays(dayTimeMatch[1]);
      const timeRanges = parseTimeRanges(dayTimeMatch[2]);
      if (days.has(todayCode) && timeRanges.length > 0) {
        matchedRanges = timeRanges;
      }
    } else {
      const timeRanges = parseTimeRanges(rule);
      if (timeRanges.length > 0) {
        matchedRanges = timeRanges;
      }
    }
  }

  if (matchedRanges && matchedRanges.length > 0) {
    let isOpen = false;
    let nextChange = '';
    for (const r of matchedRanges) {
      const close = r.closeMin <= r.openMin ? r.closeMin + 1440 : r.closeMin;
      const curr = r.closeMin <= r.openMin && currentMin < r.openMin ? currentMin + 1440 : currentMin;
      if (curr >= r.openMin && curr < close) {
        isOpen = true;
        const closeH = Math.floor(r.closeMin / 60).toString().padStart(2,'0');
        const closeM = (r.closeMin % 60).toString().padStart(2,'0');
        nextChange = I18N.t('openHours.closesAt', { t: `${closeH}:${closeM}` });
        break;
      }
    }
    if (!isOpen) {
      const sorted = [...matchedRanges].sort((a,b) => a.openMin - b.openMin);
      const next = sorted.find(r => r.openMin > currentMin) || sorted[0];
      if (next) {
        const openH = Math.floor(next.openMin / 60).toString().padStart(2,'0');
        const openM = (next.openMin % 60).toString().padStart(2,'0');
        nextChange = I18N.t('openHours.opensAt', { t: `${openH}:${openM}` });
      }
    }
    return {
      isOpen,
      label: isOpen ? I18N.t('openHours.open') : I18N.t('openHours.closed'),
      detail: nextChange,
      raw: s,
    };
  }

  // Couldn't parse — return raw string
  return { isOpen: null, label: '', detail: '', raw: s };
}

/* ═══════════════════════════════════════════════
   RELATIVE TIME — "2 giờ trước" style, for community feed posts
═══════════════════════════════════════════════ */
// PocketBase's `created` field is UTC like "2026-09-10 08:15:23.000Z"
// (space instead of 'T' — needs normalizing before Date can parse it).
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(String(dateStr).replace(' ', 'T'));
  if (isNaN(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (diffSec < 60) return I18N.t('time.justNow');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return I18N.t('time.minutesAgo', { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return I18N.t('time.hoursAgo', { n: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return I18N.t('time.daysAgo', { n: diffDay });
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return I18N.t('time.monthsAgo', { n: diffMonth });
  return I18N.t('time.yearsAgo', { n: Math.floor(diffMonth / 12) });
}

// Avatar icon markup for a community author record — falls back to a
// default for accounts created before the avatar_emoji field existed, or
// anyone who hasn't opened the avatar picker yet. avatarIcon() also
// handles records that still have a legacy emoji stored (pre-icon-system).
function authorAvatar(author) {
  return avatarIcon(author && author.avatar_emoji);
}
