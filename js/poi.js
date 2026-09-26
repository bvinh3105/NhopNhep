/* ═══════════════════════════════════════════════
   POI FETCHER — real restaurants from OpenStreetMap
   Uses Overpass API — free, no API key, ~24h fresh data
═══════════════════════════════════════════════ */
const POI = {
  DIRECT: 'https://overpass-api.de/api/interpreter',
  // Same-origin edge function — no CORS, no adblocker; races multiple
  // Overpass mirrors server-side and caches the result at the CDN.
  // Works on Cloudflare Pages (functions/api/overpass.js) and Netlify
  // (netlify.toml redirects /api/overpass to the Netlify function).
  PROXY: '/api/overpass',
  // localhost has no Pages Functions, and the public mirrors throttle/406
  // direct browser traffic — local dev also asks the deployed proxy (CORS *).
  DEPLOYED_PROXY: 'https://nhopnhep.pages.dev/api/overpass',
  _cache: new Map(),
  CACHE_TTL: 5 * 60 * 1000,
  // A bigger radius used to come back with FEWER quán. Three limits stacked:
  // `out center 200` returned 200 ARBITRARY elements (Overpass id order,
  // not distance), the query's [timeout:10] killed dense 2–5 km searches
  // server-side, and each endpoint here gave up after 8 s. Measured
  // 2026-09-26 at Duy Tân (Cầu Giấy) through the proxy, named places:
  // 1 km 78 · 2 km 276 · 5 km 980 (was capped to ~166 / ~162), 98–376 KB,
  // 1–11 s. Now: 25 s server budget, only a high safety cap, and the
  // client waits long enough. The list comes back sorted nearest-first;
  // HomeCtrl._doScan caps it at MAX_ITEMS for rendering AFTER its
  // category / dish / rating filters (capping here dropped the outer ring
  // of a filtered 5 km search).
  QUERY_TIMEOUT_S: 25,
  OUTPUT_CAP: 3000,
  FETCH_TIMEOUT_MS: 27000,
  MAX_ITEMS: 500,
  // Last fetch: lastFailed = no map answer at all (network / every mirror
  // down); lastDegraded = no COMPLETE answer (failed, or only a cut-short
  // one). A clean empty answer (an area with no mapped quán) is neither.
  lastFailed: false,
  lastDegraded: false,

  _cacheKey(lat, lng, radius) {
    return `${lat.toFixed(3)}_${lng.toFixed(3)}_${radius}`;
  },

  _query(lat, lng, radius) {
    return `[out:json][timeout:${this.QUERY_TIMEOUT_S}];
(
  node["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream|bar|pub|bbq|biergarten|canteen)$"](around:${radius},${lat},${lng});
  way["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream|bar|pub|bbq|biergarten|canteen)$"](around:${radius},${lat},${lng});
  node["shop"~"^(bakery|beverages|coffee|confectionery|pastry|deli|greengrocer|dairy)$"](around:${radius},${lat},${lng});
  way["shop"~"^(bakery|beverages|coffee|confectionery|pastry|deli)$"](around:${radius},${lat},${lng});
);
out center ${this.OUTPUT_CAP};`;
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
    return parts.length ? parts.join(' · ') : I18N.t('poi.fallbackDesc');
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
      this.lastFailed = false; this.lastDegraded = false;
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
      endpoints.push({ url: this.DEPLOYED_PROXY, method: 'POST', body: queryParam });
    } else {
      endpoints.push({ url: this.PROXY, method: 'POST', body: queryParam });
    }

    // Public CORS proxy — GET-only, forwards to overpass-api.de
    const alloriginsUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(directGetUrl);
    endpoints.push({ url: alloriginsUrl, method: 'GET' });

    // CORS-enabled Overpass mirrors (POST) — last-resort fallback
    endpoints.push({ url: 'https://overpass.kumi.systems/api/interpreter', method: 'POST', body: queryParam });
    endpoints.push({ url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', method: 'POST', body: queryParam });

    console.log('[POI] fetching concurrently from', endpoints.length, 'endpoints…');

    const abortControllers = endpoints.map(() => new AbortController());
    let partial = null, sawCleanEmpty = false;
    const promises = endpoints.map((ep, i) => {
      return new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          abortControllers[i].abort();
          reject(new Error('timeout: ' + ep.url));
        }, this.FETCH_TIMEOUT_MS);
        try {
          const fetchOpts = { method: ep.method, signal: abortControllers[i].signal };
          if (ep.body) {
            fetchOpts.body = ep.body;
            fetchOpts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
          }
          const res = await fetch(ep.url, fetchOpts);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          // The timer keeps running through the body download (100 KB–1 MB
          // now): a connection that stalls mid-body must still time out,
          // or the scan overlay would hang with nothing to release it.
          const data = await res.json();
          // An Overpass "runtime error" (timeout / memory) comes back as
          // HTTP 200 with a remark and a partial or empty list — keep it
          // only as a last resort, never let it beat a complete answer.
          if (data.remark && /runtime error/i.test(data.remark) && data.elements && data.elements.length) {
            partial = partial || { url: ep.url, elements: data.elements, index: i };
            reject(new Error('partial (' + data.remark.slice(0, 60) + ') from ' + ep.url));
          } else if (data.elements && data.elements.length > 0) {
            resolve({ url: ep.url, elements: data.elements, index: i });
          } else {
            const runtimeErr = data.remark && /runtime error/i.test(data.remark);
            if (Array.isArray(data.elements) && !runtimeErr) {
              sawCleanEmpty = true;
              // The proxy already raced 3 mirrors preferring a non-empty
              // answer — a clean empty from it means "no quán mapped here":
              // settle now instead of waiting out the slowest endpoint.
              if (ep.url === this.PROXY || ep.url === this.DEPLOYED_PROXY) return resolve({ url: ep.url, elements: [], index: i });
            }
            reject(new Error('No elements from ' + ep.url));
          }
        } catch (e) {
          reject(e);
        } finally {
          clearTimeout(timeout);
        }
      });
    });

    // Nearest first (the render cap is applied after filtering, in _doScan).
    const nearest = (elements) => this._parse(elements)
      .map(it => ({ it, d: haversine(lat, lng, it.lat, it.lng) }))
      .sort((a, b) => a.d - b.d)
      .map(x => x.it);

    try {
      const fastest = await Promise.any(promises);
      console.log('[POI] winner:', fastest.url);
      abortControllers.forEach((ctrl, i) => { if (i !== fastest.index) ctrl.abort(); });
      const items = nearest(fastest.elements);
      if (items.length) this._cache.set(key, { ts: Date.now(), items });
      this.lastFailed = false; this.lastDegraded = false;
      console.log('[POI] fetched', items.length, 'items');
      return items;
    } catch (e) {
      const detail = e.errors
        ? e.errors.map((x, i) => `${endpoints[i].url} → ${x?.message || x}`).join('\n  ')
        : (e?.message || e);
      if (partial) {
        // Better a partial list than none — but don't cache it.
        console.warn('[POI] only a partial answer came back:\n  ' + detail);
        this.lastFailed = false; this.lastDegraded = true;
        return nearest(partial.elements);
      }
      // Every endpoint said "no elements" cleanly → an area with no mapped
      // quán, not a connection problem.
      this.lastFailed = !sawCleanEmpty; this.lastDegraded = !sawCleanEmpty;
      if (this.lastFailed) console.error('[POI] All endpoints failed:\n  ' + detail);
      return [];
    }
  },
};
