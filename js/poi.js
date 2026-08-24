/* ═══════════════════════════════════════════════
   POI FETCHER — real restaurants from OpenStreetMap
   Uses Overpass API — free, no API key, ~24h fresh data
═══════════════════════════════════════════════ */
const POI = {
  DIRECT: 'https://overpass-api.de/api/interpreter',
  // Same-origin Netlify Function — no CORS, no adblocker; server-side
  // retries multiple Overpass mirrors internally.
  NETLIFY_FN: '/.netlify/functions/overpass',
  _cache: new Map(),
  CACHE_TTL: 5 * 60 * 1000,

  _cacheKey(lat, lng, radius) {
    return `${lat.toFixed(3)}_${lng.toFixed(3)}_${radius}`;
  },

  _query(lat, lng, radius) {
    return `[out:json][timeout:10];
(
  node["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream|bar|pub|bbq|biergarten|canteen)$"](around:${radius},${lat},${lng});
  way["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream|bar|pub|bbq|biergarten|canteen)$"](around:${radius},${lat},${lng});
  node["shop"~"^(bakery|beverages|coffee|confectionery|pastry|deli|greengrocer|dairy)$"](around:${radius},${lat},${lng});
  way["shop"~"^(bakery|beverages|coffee|confectionery|pastry|deli)$"](around:${radius},${lat},${lng});
);
out center 200;`;
  },

  _mapCategory(tags) {
    const a = (tags.amenity || '').toLowerCase();
    const s = (tags.shop || '').toLowerCase();
    const c = (tags.cuisine || '').toLowerCase();

    if (a === 'cafe' || a === 'bar' || a === 'pub' || s === 'coffee') return 'cafe';
    if (a === 'ice_cream' || a === 'food_court' || s === 'bakery' || s === 'confectionery' || s === 'pastry' || s === 'beverages') return 'snack';
    if (a === 'fast_food') return 'street';
    if (a === 'bbq') return 'street';
    if (a === 'restaurant') {
      if (/vietnamese|noodle|pho|bun|rice|street/.test(c)) return 'street';
      return 'restaurant';
    }
    return 'restaurant';
  },

  _guessPrice(tags) {
    const cat = this._mapCategory(tags);
    const c = (tags.cuisine || '').toLowerCase();
    if (/luxury|fine_dining|steak|sushi|japanese|french|italian|western/.test(c)) return '200k–500k';
    if (cat === 'cafe') return '30k–70k';
    if (cat === 'snack') return '15k–40k';
    if (cat === 'street') return '30k–70k';
    return '80k–200k';
  },

  _buildDesc(tags) {
    const parts = [];
    if (tags.cuisine) parts.push('🍴 ' + tags.cuisine.replace(/;/g, ', ').replace(/_/g, ' '));
    if (tags.description && tags.description.length < 60) parts.push(tags.description);
    return parts.length ? parts.join(' · ') : 'Quán từ OpenStreetMap';
  },

  _parse(elements) {
    const items = [];
    const seenNames = new Set();
    elements.forEach(e => {
      if (!e.tags || !e.tags.name) return;
      if (e.tags['disused:amenity'] || e.tags['closed'] === 'yes') return;

      const lat = e.lat ?? e.center?.lat;
      const lng = e.lon ?? e.center?.lon;
      if (lat == null || lng == null) return;

      const key = e.tags.name + '_' + lat.toFixed(4) + '_' + lng.toFixed(4);
      if (seenNames.has(key)) return;
      seenNames.add(key);

      const typePrefix = e.type === 'node' ? 1e13 : (e.type === 'way' ? 3e13 : 5e13);

      items.push({
        id: typePrefix + e.id,
        name: e.tags.name.slice(0, 60),
        cat: this._mapCategory(e.tags),
        price: this._guessPrice(e.tags),
        lat, lng,
        rating: 4.2,
        desc: this._buildDesc(e.tags),
        hours: e.tags.opening_hours || '',
        _osm: true,
      });
    });
    return items;
  },

  async _tryFetch(url, query, timeout=18000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return data.elements || [];
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  },

  async fetch(lat, lng, radius) {
    const key = this._cacheKey(lat, lng, radius);
    const cached = this._cache.get(key);
    if (cached && (Date.now() - cached.ts) < this.CACHE_TTL) {
      console.log('[POI] cache hit', key, cached.items.length);
      return cached.items;
    }

    const query = this._query(lat, lng, radius);
    const queryParam = 'data=' + encodeURIComponent(query);
    const directGetUrl = this.DIRECT + '?' + queryParam;
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

    // ── Build endpoint list ───────────────────────────────────────────────
    // On production: Netlify Function first (same-origin, no CORS, retries
    // multiple Overpass mirrors server-side), allorigins as backup.
    // On localhost: direct Overpass, then allorigins.
    // Overpass API supports GET (?data=...) and POST (body=data=...).
    const endpoints = [];

    if (isLocal) {
      endpoints.push({ url: this.DIRECT, method: 'POST', body: queryParam });
    } else {
      endpoints.push({ url: this.NETLIFY_FN, method: 'POST', body: queryParam });
    }

    // Public CORS proxy — GET-only, forwards to overpass-api.de
    const alloriginsUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(directGetUrl);
    endpoints.push({ url: alloriginsUrl, method: 'GET' });

    console.log('[POI] fetching concurrently from', endpoints.length, 'endpoints…');

    const abortControllers = endpoints.map(() => new AbortController());
    const promises = endpoints.map((ep, i) => {
      return new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          abortControllers[i].abort();
          reject(new Error('timeout: ' + ep.url));
        }, 8000);
        try {
          const fetchOpts = { method: ep.method, signal: abortControllers[i].signal };
          if (ep.body) {
            fetchOpts.body = ep.body;
            fetchOpts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
          }
          const res = await fetch(ep.url, fetchOpts);
          clearTimeout(timeout);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          if (data.elements && data.elements.length > 0) {
            resolve({ url: ep.url, elements: data.elements, index: i });
          } else {
            reject(new Error('No elements from ' + ep.url));
          }
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
    });

    try {
      const fastest = await Promise.any(promises);
      console.log('[POI] winner:', fastest.url);
      abortControllers.forEach((ctrl, i) => { if (i !== fastest.index) ctrl.abort(); });
      const items = this._parse(fastest.elements);
      this._cache.set(key, { ts: Date.now(), items });
      console.log('[POI] fetched', items.length, 'items');
      return items;
    } catch (e) {
      console.error('[POI] All endpoints failed:', e);
      return [];
    }
  },
};
