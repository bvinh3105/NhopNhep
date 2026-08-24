/* ═══════════════════════════════════════════════
   GEOCODER — address → coords via Nominatim (free, no key)
   Debounces user input, caches results, biases to Vietnam.
═══════════════════════════════════════════════ */
const Geocoder = {
  ENDPOINT: 'https://nominatim.openstreetmap.org/search',
  _cache: new Map(),
  _debounceTimers: new Map(),

  async search(q) {
    q = q.trim();
    if (q.length < 3) return [];
    const key = q.toLowerCase();
    if (this._cache.has(key)) return this._cache.get(key);

    const params = new URLSearchParams({
      q,
      format: 'json',
      limit: '6',
      'accept-language': 'vi',
      countrycodes: 'vn',
      addressdetails: '1',
    });

    try {
      const res = await fetch(`${this.ENDPOINT}?${params}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const results = (data || []).map(x => {
        const a = x.address || {};
        // Build a compact sub-line: road · district · city
        const parts = [
          a.road || a.pedestrian || a.footway,
          a.neighbourhood || a.suburb || a.quarter,
          a.city_district || a.district || a.city || a.town || a.province,
        ].filter(Boolean);
        return {
          lat: parseFloat(x.lat),
          lng: parseFloat(x.lon),
          name: (x.name || parts[0] || x.display_name.split(',')[0]).trim(),
          sub: parts.join(' · ') || x.display_name,
          fullAddress: x.display_name,
        };
      });
      this._cache.set(key, results);
      return results;
    } catch (e) {
      console.warn('[Geocode] failed', e.message);
      return [];
    }
  },

  // Debounced input handler. `id` scopes the timer so multiple inputs
  // don't step on each other (home + modal have independent timers).
  onInput(id, q, delay, callback) {
    clearTimeout(this._debounceTimers.get(id));
    this._debounceTimers.set(id, setTimeout(async () => {
      const results = await this.search(q);
      callback(results);
    }, delay));
  },

  // UI helper — render a suggestion list into a container element.
  //   suggestEl: <div class="geocode-suggest"> element
  //   results:   array from search()
  //   onPick:    (result) => void; called when user taps a row
  renderSuggestions(suggestEl, results, onPick) {
    if (!results.length) {
      suggestEl.innerHTML = '<div class="go-empty">Không tìm thấy · thử gõ chi tiết hơn</div>';
      suggestEl.classList.add('show');
      return;
    }
    suggestEl.innerHTML = results.map((r, i) => `
      <div class="go-item" data-idx="${i}">
        <div class="go-primary">📍 ${r.name}</div>
        <div class="go-sub">${r.sub}</div>
      </div>
    `).join('');
    suggestEl.classList.add('show');

    suggestEl.querySelectorAll('.go-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        onPick(results[idx]);
      });
    });
  },

  showLoading(suggestEl) {
    suggestEl.innerHTML = '<div class="go-loading">🔍 Đang tìm địa chỉ…</div>';
    suggestEl.classList.add('show');
  },

  hide(suggestEl) {
    suggestEl.classList.remove('show');
    suggestEl.innerHTML = '';
  },
};
