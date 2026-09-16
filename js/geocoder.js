/* ═══════════════════════════════════════════════
   GEOCODER — address -> coords, racing Photon (Komoot) + Nominatim (via /api/geocode).
   Photon: great fuzzy matching ("cầu giấy"), diacritic-tolerant, POIs.
   Nominatim: precise street+housenumber, better admin hierarchy in VN.
   Both providers fire; results merged and reranked so exact housenumber
   matches win before nearby POIs / fuzzy street matches.
═══════════════════════════════════════════════ */
const Geocoder = {
  ENDPOINT: 'https://photon.komoot.io/api/',
  NOMINATIM_PROXY: '/api/geocode',
  _cache: new Map(),
  _debounceTimers: new Map(),

  // True for street / house / district / city results — the kinds of hits
  // a caller looking for an ADDRESS wants. Filters random landmarks
  // (tourism), shops, restaurants, monuments. Called both for Photon
  // results (using Photon type strings) and for Nominatim results
  // (normalized into the same _type/_osmKey shape by _fetchNominatim).
  // 'road' and 'residential' added for Nominatim's street vocabulary.
  isAddressType(r) {
    const t = (r._type || '').toLowerCase();
    const k = (r._osmKey || '').toLowerCase();
    if (['house', 'street', 'district', 'city', 'locality',
         'suburb', 'hamlet', 'village', 'state', 'county',
         'postcode', 'road', 'residential'].includes(t)) return true;
    if (k === 'highway' || k === 'place') return true;
    return false;
  },

  // Haversine distance in km between two lat/lng pairs.
  _distKm(lat1, lng1, lat2, lng2) {
    const R = 6371, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },

  // Fallback bias point when the caller has no GPS fix yet: Hoàn Kiếm,
  // Hà Nội — same coordinate the map preview itself falls back to
  // (controllers.js CommunityAddModal). A LOT of Vietnamese street names
  // repeat across many provinces ("Lê Hồng Phong" alone hits Bắc Ninh,
  // TP.HCM, Hải Phòng, Cần Thơ, Nha Trang…), so searching with zero bias
  // lets Photon's own ranking surface a result in a random other city —
  // reads as "wrong" even though the search itself "worked". Almost all
  // users are in/near Hà Nội, so defaulting the bias there beats no bias
  // at all; it only matters before the user's first GPS fix or typed
  // location of this session.
  DEFAULT_BIAS_LAT: 21.0285,
  DEFAULT_BIAS_LNG: 105.8542,

  // ─── VN address parser (public — used by locationPicker.js POI filter) ───
  // Returns { housenumber?, street?, district?, city?, hasStructure }.
  // hasStructure=true means it's confident enough that structured Nominatim
  // search will help; false means fall back to free-text on both providers.
  parseAddress(q) {
    return this._parseAddress(q);
  },

  // Common VN city + district abbreviations. Diacritic-normalised keys →
  // canonical Vietnamese output. Nominatim indexes VN admin names in both
  // forms so either the abbrev-expanded or the raw string works upstream;
  // we normalize primarily for our OWN parser's routing decisions.
  _CITY: {
    'hn':'Hà Nội', 'ha noi':'Hà Nội',
    'hcm':'Hồ Chí Minh', 'tphcm':'Hồ Chí Minh', 'tp hcm':'Hồ Chí Minh',
    'sg':'Hồ Chí Minh', 'sai gon':'Hồ Chí Minh', 'saigon':'Hồ Chí Minh',
    'ho chi minh':'Hồ Chí Minh',
    'da nang':'Đà Nẵng', 'dn':'Đà Nẵng',
    'hai phong':'Hải Phòng', 'hp':'Hải Phòng',
    'can tho':'Cần Thơ',
  },
  _DIST: {
    'hk':'Hoàn Kiếm', 'bd':'Ba Đình', 'cg':'Cầu Giấy', 'dd':'Đống Đa',
    'hbt':'Hai Bà Trưng', 'th':'Tây Hồ', 'tx':'Thanh Xuân', 'hd':'Hà Đông',
    'lb':'Long Biên', 'ntl':'Nam Từ Liêm', 'btl':'Bắc Từ Liêm',
    'q1':'Quận 1', 'q2':'Quận 2', 'q3':'Quận 3', 'q4':'Quận 4', 'q5':'Quận 5',
    'q6':'Quận 6', 'q7':'Quận 7', 'q8':'Quận 8', 'q9':'Quận 9',
    'q10':'Quận 10', 'q11':'Quận 11', 'q12':'Quận 12',
    'bt':'Bình Thạnh', 'gv':'Gò Vấp', 'pn':'Phú Nhuận',
    'tb':'Tân Bình', 'tan phu':'Tân Phú', 'td':'Thủ Đức',
  },
  _RE_HOUSE:     /^(?:số\s+|s\.\s+)?(\d+[a-z]?(?:\/\d+[a-z]?)*)\s+/i,
  _RE_STREETKW:  /^(phố|đường|đ\.)\s+(?=\D)/i,
  _RE_WARDKW:    /^(p\.?|phường)\s+/i,
  _RE_DISTKW:    /^(q\.?|quận|h\.?|huyện|tx\.?)\s*/i,
  _RE_CITYKW:    /^(tp\.?|thành\s+phố|t\.)\s+/i,
  _RE_ADMINKW:   /(^|\s)(p\.|q\.|h\.|tp\.|phường|quận|huyện|thành\s+phố|đường|phố|ngõ|hẻm|số)(\s|$)/i,
  // Words that strongly signal "this is a POI/brand search, not an address".
  // When we see one WITHOUT any housenumber/admin keyword we bail on structured
  // parsing so Nominatim gets free-text (which may still hit) and Photon can
  // shine (its POI coverage is better anyway).
  _RE_NONADDR:   /\b(cafe|café|coffee|highlands|starbucks|phúc\s*long|the\s+coffee\s+house|tch|quán|nhà\s+hàng|restaurant|shop|store|phở|bún|cơm|chợ|kđt|chung\s+cư|vincom|aeon|lotte)\b/i,

  _norm(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g,'')
      .replace(/đ/g,'d').toLowerCase().replace(/\./g,'').replace(/\s+/g,' ').trim();
  },
  _normDist(s) {
    const k = this._norm(s);
    if (this._DIST[k]) return this._DIST[k];
    const m = k.match(/^q\s*(\d+)$/); if (m) return `Quận ${m[1]}`;
    return s.replace(/^q\.?\s*/i,'Quận ').replace(/^h\.?\s*/i,'Huyện ').trim();
  },
  _normCity(s) {
    const k = this._norm(s.replace(this._RE_CITYKW,''));
    return this._CITY[k] || s.replace(this._RE_CITYKW,'').trim();
  },
  // For single-comma-less queries like "phan chu trinh hoan kiem ha noi",
  // peel known admin tokens off the END and treat the remainder as street.
  _peelTail(s) {
    const t = s.split(/\s+/);
    for (let i = t.length - 1; i >= 1; i--) {
      const tail = t.slice(i).join(' ');
      if (this._CITY[this._norm(tail)]) {
        const rest = t.slice(0, i);
        for (let j = rest.length - 1; j >= 1; j--) {
          const mid = rest.slice(j).join(' ');
          if (this._DIST[this._norm(mid)]) return [rest.slice(0, j).join(' '), mid, tail];
        }
        return [rest.join(' '), tail];
      }
      if (this._DIST[this._norm(tail)]) return [t.slice(0, i).join(' '), tail];
    }
    return [s];
  },
  _parseAddress(q) {
    if (!q || typeof q !== 'string') return { hasStructure: false };
    const raw = q.trim();
    if (!raw) return { hasStructure: false };
    const hasNum = this._RE_HOUSE.test(raw + ' ');
    const hasKw  = this._RE_ADMINKW.test(raw);
    if (this._RE_NONADDR.test(raw) && !hasNum && !hasKw) return { hasStructure: false };

    let parts = raw.split(/\s*,\s*/).filter(Boolean);
    if (parts.length === 1) parts = this._peelTail(parts[0]);

    const out = {};
    parts.forEach((p0, i) => {
      const p = p0.trim();
      if (this._RE_CITYKW.test(p) || this._CITY[this._norm(p)]) { out.city = this._normCity(p); return; }
      if (this._RE_DISTKW.test(p) || this._DIST[this._norm(p)] || /^q\s*\d+$/i.test(this._norm(p))) {
        out.district = this._normDist(p); return;
      }
      if (this._RE_WARDKW.test(p)) return;         // drop wards (Nominatim VN has no ward slot)
      if (i === 0) {
        let h = p + ' ';
        const hm = h.match(this._RE_HOUSE);
        if (hm) { out.housenumber = hm[1]; h = h.slice(hm[0].length); }
        h = h.replace(this._RE_STREETKW, '').trim();
        if (h) out.street = h;
      } else if (!out.district) {
        out.district = this._normDist(p);
      }
    });

    // Only "structured enough" if we have street+admin OR two admin levels.
    // A lone "10 phan chu trinh" (no admin) still routes as free-text —
    // structured search without a city/county returns way too many hits.
    out.hasStructure =
      (!!out.street && (!!out.district || !!out.city)) ||
      (!!out.district && !!out.city);
    return out;
  },

  // ─── Search entry point (public API — unchanged signature) ───
  // Optional opts: { nearLat, nearLng } — bias results to a point AND
  // reorder them client-side by distance to it, so a Bắc Ninh result
  // never beats a Hoàn Kiếm one when the user is in Hoàn Kiếm.
  async search(q, opts = {}) {
    q = q.trim();
    if (q.length < 2) return [];
    const keyParts = [q.toLowerCase()];
    if (opts.nearLat != null && opts.nearLng != null) {
      keyParts.push(opts.nearLat.toFixed(2), opts.nearLng.toFixed(2));
    }
    const key = keyParts.join('|');
    if (this._cache.has(key)) return this._cache.get(key);

    const results = await this._fetch(q, opts);
    this._cache.set(key, results);
    return results;
  },

  // ─── _fetch: race Photon + Nominatim, merge dedupe, rerank ───
  // Wait-both mode (Promise.allSettled) so the dropdown updates ONCE with
  // the merged list — no "flash Photon, then jump to Nominatim". Per-provider
  // 3s timeout; a slow/broken provider degrades to the other alone.
  async _fetch(q, opts = {}) {
    const parsed = this._parseAddress(q);
    const settled = await Promise.allSettled([
      this._withTimeout(this._fetchPhoton(q, opts), 3000),
      this._withTimeout(this._fetchNominatim(q, opts, parsed), 3000),
    ]);
    const photon    = settled[0].status === 'fulfilled' ? settled[0].value : [];
    const nominatim = settled[1].status === 'fulfilled' ? settled[1].value : [];
    if (settled[0].status === 'rejected') console.warn('[Geocode] Photon failed', settled[0].reason?.message);
    if (settled[1].status === 'rejected') console.warn('[Geocode] Nominatim failed', settled[1].reason?.message);

    // Merge — Nominatim first so it wins dedup ties (its housenumber field
    // is authoritative). Dedup key is COORD-ONLY (rounded to 4 decimals,
    // ~11m bucket): the two providers compose `name` and `sub` from
    // different address components (Photon builds sub from
    // district|locality→city|county, Nominatim adds a suburb/city_district
    // layer), so a name+sub key never catches "same physical address, two
    // providers". Coord bucket does — Nominatim first iteration means the
    // Nominatim entry wins any collision, which is the intent.
    const merged = [];
    const seen = new Set();
    for (const r of [...nominatim, ...photon]) {
      const k = `${r.lat.toFixed(4)}|${r.lng.toFixed(4)}`;
      if (!seen.has(k)) { seen.add(k); merged.push(r); }
    }
    return this._rerank(merged, parsed, opts);
  },

  _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout ' + ms + 'ms')), ms)),
    ]);
  },

  // ─── Photon fetcher (extracted from old _fetch, behavior UNCHANGED) ───
  async _fetchPhoton(q, opts = {}) {
    const lat = opts.nearLat != null ? opts.nearLat : this.DEFAULT_BIAS_LAT;
    const lng = opts.nearLng != null ? opts.nearLng : this.DEFAULT_BIAS_LNG;
    const params = new URLSearchParams({
      q, limit: '8', lang: 'default', lat: String(lat), lon: String(lng),
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      res = await fetch(`${this.ENDPOINT}?${params}`, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error('Photon HTTP ' + res.status);
    const data = await res.json();
    if (!data.features) return [];
    return data.features.map(f => {
      const p = f.properties;
      const coords = f.geometry.coordinates; // [lon, lat]
      const parts = [
        p.housenumber, p.street,
        p.district || p.locality,
        p.city || p.county,
        p.state,
      ].filter(Boolean);
      return {
        lat: coords[1],
        lng: coords[0],
        name: p.name || parts[0] || I18N.t('geo.unnamed'),
        sub: parts.join(' · ') || (p.country || ''),
        _type: p.type || '',
        _osmKey: p.osm_key || '',
        _osmValue: p.osm_value || '',
        _housenumber: p.housenumber || '',
        _provider: 'photon',
      };
    });
  },

  // ─── Nominatim fetcher (new, via CF Function /api/geocode) ───
  async _fetchNominatim(q, opts = {}, parsed) {
    const url = new URL(this.NOMINATIM_PROXY, window.location.origin);
    if (parsed && parsed.hasStructure) {
      // Structured — precision path
      if (parsed.housenumber) url.searchParams.set('housenumber', parsed.housenumber);
      if (parsed.street)     url.searchParams.set('street',      parsed.street);
      if (parsed.district)   url.searchParams.set('district',    parsed.district);
      if (parsed.city)       url.searchParams.set('city',        parsed.city);
    } else {
      // Free-text
      url.searchParams.set('q', q);
    }
    // Bias viewbox: ±0.15 deg (~16km) around the bias point. Nominatim
    // reads it as "west,south,east,north" (lon,lat pairs). Soft bias only
    // (bounded=0 in the Function), so far-away results still come back if
    // nothing local matches.
    const lat = opts.nearLat != null ? opts.nearLat : this.DEFAULT_BIAS_LAT;
    const lng = opts.nearLng != null ? opts.nearLng : this.DEFAULT_BIAS_LNG;
    const west  = (lng - 0.15).toFixed(4);
    const east  = (lng + 0.15).toFixed(4);
    const north = (lat + 0.15).toFixed(4);
    const south = (lat - 0.15).toFixed(4);
    url.searchParams.set('viewbox', `${west},${south},${east},${north}`);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      res = await fetch(url.toString(), { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error('Nominatim HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map(hit => {
      const addr = hit.address || {};
      // Compose sub the same way Photon-side does so dedup keys line up.
      const parts = [
        addr.house_number,
        addr.road,
        addr.suburb || addr.city_district || addr.district || addr.county,
        addr.city || addr.town || addr.village,
        addr.state,
      ].filter(Boolean);
      // 'type' in json format is the OSM tag VALUE; 'class' is the tag KEY.
      // Map into the same _type / _osmKey slots isAddressType() reads.
      // Nominatim's "road"/"residential" are what Photon calls "street" —
      // widened isAddressType above covers them.
      const nominatimType = (hit.type || '').toLowerCase();
      const nominatimClass = (hit.class || '').toLowerCase();
      return {
        lat: parseFloat(hit.lat),
        lng: parseFloat(hit.lon),
        // Nominatim's /search returns `name` only if we ask for
        // `namedetails=1` (we don't). Without it, `hit.name` is undefined
        // for POI/street/house alike, so a naïve `hit.name || addr.road`
        // fallback would show "Phố Nguyễn Chí Thanh" instead of "Highlands
        // Coffee" for a POI whose road happens to be Nguyễn Chí Thanh.
        // `display_name` always leads with the entity's own name (POI,
        // street or admin unit), so try it BEFORE we fall through to the
        // address components.
        name: hit.name
              || (hit.display_name || '').split(',')[0].trim()
              || addr.road || addr.suburb || addr.city
              || I18N.t('geo.unnamed'),
        sub: parts.join(' · ') || (addr.country || ''),
        _type: nominatimType,
        _osmKey: nominatimClass,
        _osmValue: '',
        _housenumber: addr.house_number || '',
        _provider: 'nominatim',
      };
    });
  },

  // ─── Rerank ───
  // Rank buckets (lower = better):
  //   0: Nominatim result whose _housenumber == parsed.housenumber (exact hit)
  //   1: Nominatim address-type
  //   2: Photon address-type
  //   3: Everything else (POI, unclassified)
  // Within a bucket, sort by Haversine distance to the bias point.
  _rerank(results, parsed, opts) {
    const lat = opts.nearLat != null ? opts.nearLat : this.DEFAULT_BIAS_LAT;
    const lng = opts.nearLng != null ? opts.nearLng : this.DEFAULT_BIAS_LNG;
    results.forEach(r => { r._distKm = this._distKm(r.lat, r.lng, lat, lng); });
    const wantedHouse = parsed && parsed.housenumber ? String(parsed.housenumber) : '';
    const rankBucket = r => {
      if (r._provider === 'nominatim' && wantedHouse
          && String(r._housenumber || '') === wantedHouse) return 0;
      if (r._provider === 'nominatim' && this.isAddressType(r)) return 1;
      if (r._provider === 'photon'    && this.isAddressType(r)) return 2;
      return 3;
    };
    results.sort((a, b) => {
      const ra = rankBucket(a), rb = rankBucket(b);
      if (ra !== rb) return ra - rb;
      return a._distKm - b._distKm;
    });
    return results;
  },

  // Reverse geocode — coords -> human-readable Vietnamese address.
  // Uses Photon's /reverse endpoint (same host as forward search).
  // Returns a string like "10 Phố Hàng Giấy, Hoàn Kiếm, Hà Nội" or
  // null on failure. Cached in-memory per rounded (5-decimal) coord.
  // Unchanged — reverse via Nominatim is a separate future call.
  async reverse(lat, lng) {
    if (lat == null || lng == null) return null;
    const key = `rev|${lat.toFixed(5)}|${lng.toFixed(5)}`;
    if (this._cache.has(key)) return this._cache.get(key);
    const url = 'https://photon.komoot.io/reverse?' + new URLSearchParams({
      lat: String(lat), lon: String(lng), lang: 'default',
    });
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let res;
      try {
        res = await fetch(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const f = data.features && data.features[0];
      if (!f) { this._cache.set(key, null); return null; }
      const p = f.properties || {};
      // Vietnamese address format: "39 Phố Tuệ Tĩnh, Hai Bà Trưng, Hà Nội"
      // — number + street go together, then district and city are
      // comma-separated. Locality (ward) is often too granular; use
      // it only if district is missing.
      const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ');
      const parts = [
        streetLine,
        p.district || p.locality,
        p.city || p.county,
      ].filter(Boolean);
      const address = parts.length ? parts.join(', ')
        : (p.name || p.state || null);
      this._cache.set(key, address);
      return address;
    } catch (e) {
      console.warn('[Reverse geocode] failed', e.message);
      return null;
    }
  },

  onInput(id, q, delay, callback, opts) {
    clearTimeout(this._debounceTimers.get(id));
    this._debounceTimers.set(id, setTimeout(async () => {
      const results = await this.search(q, opts);
      callback(results);
    }, delay));
  },

  renderSuggestions(suggestEl, results, onPick) {
    if (!results.length) {
      suggestEl.innerHTML = `
        <div class="go-empty">
          ${I18N.t('geo.noResults')}
        </div>`;
      suggestEl.classList.add('show');
      return;
    }

    // Deduplicate identical names+subs
    const unique = [];
    const seen = new Set();
    for (const r of results) {
       const k = r.name + '|' + r.sub;
       if (!seen.has(k)) {
          seen.add(k);
          unique.push(r);
       }
    }

    suggestEl.innerHTML = unique.map((r, i) => `
      <div class="go-item" data-idx="${i}">
        <div class="go-primary">📍 ${escapeHtml(r.name)}</div>
        <div class="go-sub">${escapeHtml(r.sub)}</div>
      </div>
    `).join('');
    suggestEl.classList.add('show');

    suggestEl.querySelectorAll('.go-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        onPick(unique[idx]);
      });
    });
  },

  showLoading(suggestEl) {
    suggestEl.innerHTML = `<div class="go-loading">${I18N.t('geo.searching')}</div>`;
    suggestEl.classList.add('show');
  },

  hide(suggestEl) {
    suggestEl.classList.remove('show');
    suggestEl.innerHTML = '';
  },
};
