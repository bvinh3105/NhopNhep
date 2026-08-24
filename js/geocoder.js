/* ═══════════════════════════════════════════════
   GEOCODER — address -> coords via Photon (Komoot)
   Faster and much better at fuzzy searching (like "cầu giấy")
═══════════════════════════════════════════════ */
const Geocoder = {
  ENDPOINT: 'https://photon.komoot.io/api/',
  _cache: new Map(),
  _debounceTimers: new Map(),

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

  async _fetch(q, opts = {}) {
    const params = new URLSearchParams({
      q: q,
      limit: '8',
      lang: 'default', // Photon mostly uses default local names (Vietnamese)
    });
    // Bias the upstream search to the caller's reference point when
    // provided; otherwise fall back to center-of-VN so unrelated
    // countries never bubble up.
    const biasLat = opts.nearLat != null ? opts.nearLat : 16.0;
    const biasLng = opts.nearLng != null ? opts.nearLng : 106.0;
    params.set('lat', String(biasLat));
    params.set('lon', String(biasLng));

    let searchQuery = q;
    if (!/vietnam|việt nam|vn/i.test(q)) {
       searchQuery = q + ', Việt Nam';
    }
    params.set('q', searchQuery);

    try {
      const res = await fetch(`${this.ENDPOINT}?${params}`);
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
          name: p.name || parts[0] || 'Địa điểm không tên',
          sub: parts.join(' · ') || (p.country || ''),
        };
      });

      // Reorder by real distance to the bias point — Photon's own
      // ranking sometimes puts far results first when the query text
      // matches an unrelated place name (e.g. "giao" → "Giao hàng
      // Bắc Ninh" beating "Hoàn Kiếm" in Hà Nội).
      if (opts.nearLat != null && opts.nearLng != null) {
        results.forEach(r => {
          r._distKm = this._distKm(r.lat, r.lng, opts.nearLat, opts.nearLng);
        });
        results.sort((a, b) => a._distKm - b._distKm);
      }
      return results;
    } catch (e) {
      console.warn('[Geocode] failed', e.message);
      return [];
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
      suggestEl.innerHTML = '<div class="go-empty">Không tìm thấy · thử gõ tên đường, quận...</div>';
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
        <div class="go-primary">📍 ${r.name}</div>
        <div class="go-sub">${r.sub}</div>
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
    suggestEl.innerHTML = '<div class="go-loading">📍 Đang tìm địa chỉ...</div>';
    suggestEl.classList.add('show');
  },

  hide(suggestEl) {
    suggestEl.classList.remove('show');
    suggestEl.innerHTML = '';
  },
};
