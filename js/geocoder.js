/* ═══════════════════════════════════════════════
   GEOCODER — address -> coords via Photon (Komoot)
   Faster and much better at fuzzy searching (like "cầu giấy")
═══════════════════════════════════════════════ */
const Geocoder = {
  ENDPOINT: 'https://photon.komoot.io/api/',
  _cache: new Map(),
  _debounceTimers: new Map(),

  async search(q) {
    q = q.trim();
    if (q.length < 2) return [];
    const key = q.toLowerCase();
    if (this._cache.has(key)) return this._cache.get(key);

    const results = await this._fetch(q);
    this._cache.set(key, results);
    return results;
  },

  async _fetch(q) {
    const params = new URLSearchParams({
      q: q,
      limit: '6',
      lang: 'default', // Photon mostly uses default local names (Vietnamese)
    });
    // Bias towards Vietnam (lat, lon, zoom scale roughly)
    params.set('lon', '106.0');
    params.set('lat', '16.0');
    
    // Add location bias to speed up VN results if we want, but simple q is fine
    // Or we can just append "Việt Nam" if user didn't type it to restrict results
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

      return data.features.map(f => {
        const p = f.properties;
        const coords = f.geometry.coordinates; // [lon, lat]
        
        const parts = [
          p.housenumber,
          p.street,
          p.district || p.locality,
          p.city || p.county,
          p.state
        ].filter(Boolean);

        return {
          lat: coords[1],
          lng: coords[0],
          name: p.name || parts[0] || 'Địa điểm không tên',
          sub: parts.join(' · ') || (p.country || ''),
        };
      });
    } catch (e) {
      console.warn('[Geocode] failed', e.message);
      return [];
    }
  },

  onInput(id, q, delay, callback) {
    clearTimeout(this._debounceTimers.get(id));
    this._debounceTimers.set(id, setTimeout(async () => {
      const results = await this.search(q);
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
