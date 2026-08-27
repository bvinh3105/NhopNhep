/* ═══════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════ */
const CATEGORIES = {
  restaurant: { label:'Nhà hàng',  icon:'🍽️', color:'#B92626', dwell:60 },
  street:     { label:'Vỉa hè',    icon:'🍜', color:'#E8843C', dwell:30 },
  snack:      { label:'Ăn vặt',    icon:'🧆', color:'#D64B7A', dwell:20 },
  cafe:       { label:'Cà phê',    icon:'☕', color:'#7A4E2F', dwell:45 },
};

const AVATARS = ['🍜','🍕','🍔','🍣','🍰','🍩','🍦','🥗','🌮','🍤','🍱','🥘','🍲','🥟','🍢','☕','🧋','🍹'];

/* ═══════════════════════════════════════════════
   UTILITY FUNCTIONS
═══════════════════════════════════════════════ */
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
  return [...State.userRestaurants, ...State.osmRestaurants];
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
    return { isOpen: true, label: 'Mở 24/7', detail: '', raw: s };
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
        nextChange = `Đóng lúc ${closeH}:${closeM}`;
        break;
      }
    }
    if (!isOpen) {
      const sorted = [...matchedRanges].sort((a,b) => a.openMin - b.openMin);
      const next = sorted.find(r => r.openMin > currentMin) || sorted[0];
      if (next) {
        const openH = Math.floor(next.openMin / 60).toString().padStart(2,'0');
        const openM = (next.openMin % 60).toString().padStart(2,'0');
        nextChange = `Mở lúc ${openH}:${openM}`;
      }
    }
    return {
      isOpen,
      label: isOpen ? 'Đang mở' : 'Đã đóng',
      detail: nextChange,
      raw: s,
    };
  }

  // Couldn't parse — return raw string
  return { isOpen: null, label: '', detail: '', raw: s };
}
