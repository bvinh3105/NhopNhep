/* ═══════════════════════════════════════════════
   GEOCODER — address -> coords via Photon (Komoot)
   Faster and much better at fuzzy searching (like "cầu giấy")
═══════════════════════════════════════════════ */
const Geocoder = {
  ENDPOINT: 'https://photon.komoot.io/api/',
  _cache: new Map(),
  _debounceTimers: new Map(),

  // True for street / house / district / city results — the kinds of
  // hits a caller looking for an ADDRESS wants. Filters out random
  // landmarks (tourism), shops, restaurants, monuments etc.
  isAddressType(r) {
    const t = (r._type || '').toLowerCase();
    const k = (r._osmKey || '').toLowerCase();
    if (['house', 'street', 'district', 'city', 'locality',
         'suburb', 'hamlet', 'village', 'state', 'county',
         'postcode'].includes(t)) return true;
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

  async _fetch(q, opts = {}) {
    const lat = opts.nearLat != null ? opts.nearLat : this.DEFAULT_BIAS_LAT;
    const lng = opts.nearLng != null ? opts.nearLng : this.DEFAULT_BIAS_LNG;
    const params = new URLSearchParams({
      q: q,
      limit: '8',
      lang: 'default', // Photon uses each place's own local name
      lat: String(lat),
      lon: String(lng),
    });

    try {
      // Abort after 8s — on a slow/flaky mobile connection a hung fetch
      // used to leave the "Đang tìm địa chỉ…" loading state on screen
      // forever with no way out. Timing out lets it fail into the normal
      // empty-results UI instead.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let res;
      try {
        res = await fetch(`${this.ENDPOINT}?${params}`, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.features) return [];

      let results = data.features.map(f => {
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
          // Photon classification kept so callers can filter POIs out
          // when they wanted an address, not a landmark or shop.
          _type: p.type || '',
          _osmKey: p.osm_key || '',
          _osmValue: p.osm_value || '',
        };
      });

      // Reorder by real distance to the bias point (always — either the
      // caller's real GPS fix, or the Hà Nội fallback above) since
      // Photon's own ranking sometimes puts far results first when the
      // query text matches an unrelated place name (e.g. "giao" → "Giao
      // hàng Bắc Ninh" beating "Hoàn Kiếm" in Hà Nội, or a street name
      // that repeats across many provinces).
      results.forEach(r => {
        r._distKm = this._distKm(r.lat, r.lng, lat, lng);
      });
      results.sort((a, b) => a._distKm - b._distKm);
      return results;
    } catch (e) {
      console.warn('[Geocode] failed', e.message);
      return [];
    }
  },

  // Reverse geocode — coords -> human-readable Vietnamese address.
  // Uses Photon's /reverse endpoint (same host as forward search).
  // Returns a string like "10 Phố Hàng Giấy, Hoàn Kiếm, Hà Nội" or
  // null on failure. Cached in-memory per rounded (5-decimal) coord.
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
