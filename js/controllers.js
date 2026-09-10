/* ═══════════════════════════════════════════════
   HOME CONTROLLER
═══════════════════════════════════════════════ */
const HomeCtrl = {
  init() {
    document.getElementById('catChips').addEventListener('click', e => {
      const chip = e.target.closest('.cat-chip');
      if (!chip) return;
      const cat = chip.dataset.cat;
      if (State.activeCats.has(cat)) {
        if (State.activeCats.size === 1) { showToast(I18N.t('toast.needOneCat')); return; }
        State.activeCats.delete(cat);
        chip.classList.remove('active');
      } else {
        State.activeCats.add(cat);
        chip.classList.add('active');
      }
      this._updateBadge();
    });

    document.getElementById('radiusChips').addEventListener('click', e => {
      const chip = e.target.closest('.radius-chip');
      if (!chip) return;
      document.querySelectorAll('#radiusChips .radius-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      State.radius = parseInt(chip.dataset.r);
      MapHome.updateRadius();
    });

    // Source chips
    document.getElementById('srcChips').addEventListener('click', e => {
      const chip = e.target.closest('.cat-chip');
      if (!chip) return;
      const src = chip.dataset.src;
      if (src === 'community') {
        showToast(I18N.t('toast.ratingSoon'));
        return;
      }
      if (State.activeSrcs.has(src)) {
        if (State.activeSrcs.size === 1) { showToast(I18N.t('toast.needOneSrc')); return; }
        State.activeSrcs.delete(src);
        chip.classList.remove('active');
      } else {
        State.activeSrcs.add(src);
        chip.classList.add('active');
      }
      this._updateBadge();
    });

    // Min rating chips
    document.getElementById('minRatingChips').addEventListener('click', e => {
      const chip = e.target.closest('.radius-chip');
      if (!chip) return;
      document.querySelectorAll('#minRatingChips .radius-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      State.minRating = parseFloat(chip.dataset.rating);
    });

    document.getElementById('gpsBtn').addEventListener('click', () => GPS.toggle());

    // Advanced filters collapsible
    const advBtn = document.getElementById('advToggle');
    const advBody = document.getElementById('advBody');
    advBtn.addEventListener('click', () => {
      const isOpen = advBtn.getAttribute('aria-expanded') === 'true';
      advBtn.setAttribute('aria-expanded', String(!isOpen));
      advBody.classList.toggle('open', !isOpen);
    });

    document.getElementById('scanBtn').addEventListener('click', () => this.scan());

    // Dish search — free-text input + shortcut chips
    this._initDishSearch();

    // Address autocomplete for "Điểm xuất phát"
    this._initLocInput();

    this._initEasterEgg();

    this._updateBadge();
  },

  // Easter egg — "vi vu cùng Vinh và Thảo ♥" ẩn mặc định, bấm liên tiếp 5
  // lần vào tiêu đề mới hiện ra. Đếm reset nếu khoảng cách giữa 2 lần bấm
  // quá 1.5s, để bấm rời rạc qua nhiều lần mở app không vô tình trúng.
  _initEasterEgg() {
    const title = document.getElementById('heroTitle');
    const tagline = document.getElementById('heroTagline');
    if (!title || !tagline) return;
    let count = 0;
    let lastTap = 0;
    title.addEventListener('click', () => {
      const now = Date.now();
      count = (now - lastTap > 1500) ? 1 : count + 1;
      lastTap = now;
      if (count >= 5) {
        count = 0;
        if (!tagline.classList.contains('show')) {
          tagline.classList.add('show');
          showToast('💕 Easter egg!');
        }
      }
    });
  },

  // Debounced address suggestions dropdown for the "Điểm xuất phát" field.
  // Selecting a suggestion re-centers the map so the user can see exactly
  // where the scan will happen before pressing Quét.
  _initLocInput() {
    const input = document.getElementById('locInput');
    const suggest = document.getElementById('locSuggest');
    if (!input || !suggest) return;
    DropdownPosition.register(input, suggest);
    const reposition = () => DropdownPosition.reposition(input, suggest);

    const pick = (r) => {
      MapHome.setUserLocation(r.lat, r.lng, null, { center: true });
      input.value = r.name;
      Geocoder.hide(suggest);
      showToast(`📍 ${r.sub}`);
    };

    const bias = () => ({ nearLat: State.userLat, nearLng: State.userLng });

    input.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (q.length < 3) { Geocoder.hide(suggest); return; }
      reposition();
      Geocoder.showLoading(suggest);
      Geocoder.onInput('locInput', q, 450, (results) => {
        reposition();
        Geocoder.renderSuggestions(suggest, results, pick);
      }, bias());
    });

    // Enter picks the first suggestion, or triggers a scan if nothing typed
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = input.value.trim();
      if (!q) { this.scan(); return; }
      reposition();
      Geocoder.showLoading(suggest);
      const results = await Geocoder.search(q, bias());
      reposition();
      if (results.length) { pick(results[0]); }
      else { Geocoder.renderSuggestions(suggest, [], pick); }
    });

    // Click outside dismisses the dropdown
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.loc-row-wrap')) Geocoder.hide(suggest);
    });
    input.addEventListener('focus', () => {
      if (input.value.trim().length >= 3) suggest.classList.add('show');
    });
  },

  _updateBadge() {
    const badge = document.getElementById('scanCountBadge');
    const total = allRestaurants().length;
    badge.textContent = total > 0 ? I18N.t('hero.badgeCount', { n: total }) : I18N.t('hero.badge');
  },

  _scanning: false,
  _scanCache: new Map(),   // { key → { items, source, ts } }
  _SCAN_TTL: 10 * 60 * 1000, // 10 min

  _cacheKey() {
    const cats = [...State.activeCats].sort().join(',');
    const dish = (State.activeDish || '').trim().toLowerCase();
    return `${State.userLat.toFixed(3)}_${State.userLng.toFixed(3)}_${State.radius}_${cats}_${dish}`;
  },

  async scan() {
    if (this._scanning) return;

    // Auto-geocode typed address if location not explicitly set
    const locInput = document.getElementById('locInput');
    const typedQ = locInput ? locInput.value.trim() : '';
    // Consider "default HCMC" as unset — check if it's still the boot placeholder
    const isDefault = locInput && locInput.value.startsWith('📌');
    if (isDefault && typedQ.length < 3) {
      showToast(I18N.t('toast.typeAddrOrGps'));
      return;
    }
    if (isDefault || !State.userLat) {
      if (typedQ.length >= 3) {
        showToast(I18N.t('toast.findingLocation'), 1500);
        const results = await Geocoder.search(typedQ.replace(/^📌\s*/, ''), { nearLat: State.userLat, nearLng: State.userLng });
        if (results.length) {
          MapHome.setUserLocation(results[0].lat, results[0].lng, null, { center: true });
          if (locInput) locInput.value = results[0].name;
          Geocoder.hide(document.getElementById('locSuggest'));
        }
      }
      if (!State.userLat || isDefault) {
        showToast(I18N.t('toast.useGpsOrAddr'));
        return;
      }
    }

    // ── Cache hit → instant ──────────────────────────────────────────────
    const ck = this._cacheKey();
    const hit = this._scanCache.get(ck);
    if (hit && Date.now() - hit.ts < this._SCAN_TTL) {
      State.osmRestaurants = hit.items;
      State.lastScanSource = hit.source;
      this._doScan();
      showToast(I18N.t('toast.fromCache'), 1800);
      return;
    }

    // ── Fresh scan ───────────────────────────────────────────────────────
    this._scanning = true;
    const ov = document.getElementById('scanOverlay');
    const txt = ov.querySelector('.scanning-txt');
    ov.style.display = 'flex';

    const setTxt = (msg) => { if (txt) txt.textContent = msg; };
    const sub = document.getElementById('scanSub');
    const setSubTxt = (msg) => { if (sub) sub.textContent = msg; };

    let items = [];
    let source = 'none';

    if (State.activeSrcs.has('osm')) {
      const activeCats = [...State.activeCats];
      const useGemini = typeof Gemini !== 'undefined' &&
        typeof Gemini.isConfigured === 'function' &&
        Gemini.isConfigured();

      // Animated status while waiting
      const statusMsgs = (useGemini ? I18N.t('scan.loadingMsgsGemini') : I18N.t('scan.loadingMsgsOsm')).split('|');
      let msgIdx = 0;
      setTxt(statusMsgs[0]);
      const statusTick = setInterval(() => {
        msgIdx = (msgIdx + 1) % statusMsgs.length;
        setTxt(statusMsgs[msgIdx]);
      }, 3000);

      // Elapsed timer — shows user it's actively working (not frozen)
      const scanStart = performance.now();
      const elapsedTick = setInterval(() => {
        const s = Math.floor((performance.now() - scanStart) / 1000);
        setSubTxt(I18N.t('scan.subTick', { s }));
      }, 1000);
      setSubTxt(I18N.t('scan.subTick', { s: 0 }));

      const dishQuery = (State.activeDish || '').trim();
      const geminiP = useGemini
        ? Gemini.findQuan(State.userLat, State.userLng, State.radius,
            { categories: activeCats, limit: 20, dish: dishQuery })
            .catch(e => { console.warn('[Gemini]', e.message); return []; })
        : Promise.resolve([]);

      const osmP = POI.fetch(State.userLat, State.userLng, State.radius)
        .catch(e => { console.warn('[OSM]', e.message); return []; });

      let raceResult;
      if (dishQuery && useGemini) {
        // ── DISH SEARCH: Gemini recalls real, well-known places for the
        //    dish (from model knowledge, not a live search index — its
        //    coverage of a common dish like "lẩu" is real but incomplete,
        //    e.g. it found 5 while Google Maps' actual index shows 13-15
        //    for the same spot). Rather than treating Gemini vs OSM as
        //    either/or, ALWAYS also text-match OSM's real indexed listings
        //    against the dish name — a lot of Vietnamese quán literally
        //    have the dish in their name ("Lẩu Phan", "Lẩu Bò Tơ...") so
        //    OSM catches genuine places Gemini's recall missed — then
        //    merge, deduped by name, so coverage is the union of both
        //    instead of capped at whichever one "won". ───────────────────
        const [g, o] = await Promise.all([geminiP, osmP]);
        const dishTokens = this._strip(dishQuery).split(/\s+/).filter(Boolean);
        const gNames = new Set(g.map(r => this._strip(r.name)));
        const oMatched = o.filter(r => this._dishMatches(r, dishTokens) && !gNames.has(this._strip(r.name)));
        const merged = [...g, ...oMatched];
        raceResult = { items: merged, source: merged.length ? (g.length ? 'gemini' : 'osm') : 'none' };
      } else {
        // ── GENERAL SEARCH: race both, first non-empty wins (fastest UX)
        raceResult = await new Promise(resolve => {
          let done = false;
          let finished = 0;
          const total = useGemini ? 2 : 1;
          const finish = (it, src) => {
            finished++;
            if (done) return;
            if (it.length) { done = true; resolve({ items: it, source: src }); }
            else if (finished >= total) { done = true; resolve({ items: [], source: 'none' }); }
          };
          geminiP.then(r => finish(r, 'gemini'));
          osmP.then(r => finish(r, 'osm'));
          setTimeout(() => { if (!done) { done = true; resolve({ items: [], source: 'none' }); } }, 20000);
        });
      }

      clearInterval(statusTick);
      clearInterval(elapsedTick);
      items = raceResult.items;
      source = raceResult.source;
    }

    // Cache the result
    if (items.length) this._scanCache.set(ck, { items, source, ts: Date.now() });

    State.osmRestaurants = items;
    State.lastScanSource = source;
    // Data-source name is intentionally dev-only (devtools console) — never
    // shown in the UI. Users shouldn't need to know/care which map backend
    // answered a given scan.
    console.debug('[scan] source:', source, '· items:', items.length);
    ov.style.display = 'none';
    this._scanning = false;

    // ── Toast kết quả ───────────────────────────────────────────────────
    if (items.length) {
      showToast(source === 'gemini'
        ? I18N.t('toast.foundN', { n: items.length, src: '✨ Gemini' })
        : I18N.t('toast.foundNPlain', { n: items.length }), 2200);
    } else if (State.activeSrcs.has('osm')) {
      // Nothing came back from either source
      const geminiOn = typeof Gemini !== 'undefined' && Gemini.isConfigured();
      if (!geminiOn) {
        showToast(I18N.t('toast.noGeminiKey'), 4000);
      } else {
        showToast(I18N.t('toast.noResults'), 3500);
      }
    }

    this._doScan();
  },

  _srcOf(r) {
    if (r._gemini) return 'osm';   // treat gemini as part of "osm" source bucket
    if (r.id >= 1e13) return 'osm';
    return 'mine';
  },

  // Accent-insensitive Vietnamese matcher — "pho" matches "Phở",
  // "banh mi" matches "Bánh mì", "trasua" matches "Trà sữa". Splits
  // on whitespace so word order doesn't matter and every word must
  // appear somewhere in the haystack.
  _dishMatches(r, needleTokens) {
    if (!needleTokens.length) return true;
    const hay = this._strip(`${r.name || ''} ${r.desc || ''} ${r.cuisine || ''}`);
    return needleTokens.every(t => hay.includes(t));
  },
  _strip(s) {
    return (s || '').normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toLowerCase();
  },

  _initDishSearch() {
    const input = document.getElementById('dishInput');
    const clear = document.getElementById('dishClearBtn');
    const suggest = document.getElementById('dishSuggest');
    if (!input || !suggest) return;

    const syncChips = () => {
      const active = this._strip(State.activeDish);
      suggest.querySelectorAll('.dish-chip').forEach(c => {
        c.classList.toggle('active', active && this._strip(c.dataset.dish) === active);
      });
      clear.style.display = State.activeDish ? '' : 'none';
    };

    // Show suggestions when the input is focused, hide on blur with a
    // small delay so tapping a chip has time to register.
    input.addEventListener('focus', () => suggest.classList.add('show'));
    input.addEventListener('blur', () => {
      setTimeout(() => suggest.classList.remove('show'), 180);
    });

    input.addEventListener('input', () => {
      State.activeDish = input.value.trim();
      syncChips();
    });

    clear.addEventListener('click', () => {
      input.value = '';
      State.activeDish = '';
      syncChips();
      showToast(I18N.t('toast.dishFilterCleared'));
      input.focus();
    });

    // mousedown fires BEFORE blur so the input blur handler doesn't
    // race the click and close the dropdown before we can react.
    suggest.addEventListener('mousedown', (e) => {
      const chip = e.target.closest('.dish-chip');
      if (!chip) return;
      e.preventDefault();
      const dish = chip.dataset.dish || '';
      if (this._strip(State.activeDish) === this._strip(dish)) {
        input.value = '';
        State.activeDish = '';
      } else {
        input.value = dish;
        State.activeDish = dish;
      }
      syncChips();
      input.blur();
    });
  },

  _doScan() {
    const pool = allRestaurants();
    const dishTokens = this._strip(State.activeDish).split(/\s+/).filter(Boolean);
    const hasQuery = dishTokens.length > 0;
    const results = pool.filter(r => {
      const src = this._srcOf(r);
      if (!State.activeSrcs.has(src)) return false;
      if (!State.activeCats.has(r.cat)) return false;
      if (State.minRating > 0 && (r.rating || 0) < State.minRating) return false;
      const dist = haversine(State.userLat, State.userLng, r.lat, r.lng);
      r._dist = dist;
      // Radius filter — but a named query (dish/place) fetched from Gemini
      // may legitimately sit outside the circle; the user asked for THAT
      // specific thing, so keep it and just show the real distance.
      if (dist > State.radius && !(r._gemini && hasQuery)) return false;
      if (dishTokens.length && !r._gemini && !this._dishMatches(r, dishTokens)) return false;
      return true;
    });

    // Did we actually match the typed query? (used to offer a Google Maps
    // search when we only have generic fallback results.)
    State.queryUnmatched = hasQuery && results.length === 0;

    if (results.length === 0 && dishTokens.length && pool.length > 0) {
      // Dish filter eliminated everything — fallback: show all nearby results
      const fallback = pool.filter(r => {
        if (!State.activeSrcs.has(this._srcOf(r))) return false;
        if (!State.activeCats.has(r.cat)) return false;
        const dist = haversine(State.userLat, State.userLng, r.lat, r.lng);
        if (dist > State.radius) return false;
        r._dist = dist;
        return true;
      });
      if (fallback.length) {
        showToast(I18N.t('toast.dishNotFoundFallback', { q: State.activeDish, n: fallback.length }), 3000);
        results.push(...fallback);
      }
    }

    if (results.length === 0) {
      // A specific typed query we couldn't resolve → don't dead-end. Show
      // the results screen with a "search on Google Maps" escape so the
      // user still reaches the real place (Google autocompletes "coo").
      if (State.activeDish) {
        State.filteredResults = [];
        State.selected.clear();
        State.tabFilter = 'all';
        MapHome.showRestaurants([]);
        ResultsCtrl.show();
        this._updateBadge();
        return;
      }
      let hint = I18N.t('hint.tryRadiusOrGps');
      if (!State.activeSrcs.has('osm')) hint = I18N.t('hint.enableOsm');
      showToast(I18N.t('toast.noResultsHint', { hint }));
      MapHome.showRestaurants([]);
      return;
    }

    results.sort((a,b) => a._dist - b._dist);
    for (let i = 0; i < results.length-1; i += 3) {
      if (Math.random() < 0.5) [results[i], results[i+1]] = [results[i+1], results[i]];
    }

    State.filteredResults = results;
    State.selected.clear();
    State.tabFilter = 'all';
    
    // Feature: Show restaurants on map immediately
    MapHome.showRestaurants(results);

    ResultsCtrl.show();
    this._updateBadge();
  },
};

/* ═══════════════════════════════════════════════
   RESULTS CONTROLLER
═══════════════════════════════════════════════ */
const ResultsCtrl = {
  show() {
    document.getElementById('homeScreen').classList.add('hidden');
    document.getElementById('resultsScreen').classList.remove('hidden');
    this._updateHeader();
    this._setTabFilter('all');
  },
  _updateHeader() {
    const n = State.filteredResults.length;
    document.getElementById('resultsTitle').textContent = I18N.t('results.nCount', { n });
    // Data-source name is dev-only info (see console.debug in scan()) — the
    // OSM case intentionally shows no source suffix here, just the radius.
    const src = State.lastScanSource === 'gemini' ? '✨ Google Maps (Gemini)'
      : State.lastScanSource === 'osm' ? ''
      : I18N.t('results.notScanned');
    document.getElementById('resultsSub').textContent = src ? `${fmtDist(State.radius)} · ${src}` : fmtDist(State.radius);
  },
  _setTabFilter(filter) {
    State.tabFilter = filter;
    document.querySelectorAll('.cat-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.filter === filter);
    });
    this._applyFilters();
  },

  _applyFilters() {
    const catF = State.tabFilter || 'all';
    State.visibleResults = catF === 'all'
      ? State.filteredResults
      : State.filteredResults.filter(r => r.cat === catF);
    this._render();
  },

  _renderHoursBadge(r) {
    if (!r.hours) return '';
    const parsed = parseOpeningHours(r.hours);
    if (!parsed) return '';

    if (parsed.isOpen === true) {
      return `<div class="r-hours">
        <span class="hours-badge open">🟢 ${parsed.label}</span>
        <span class="hours-detail">${parsed.detail}</span>
      </div>`;
    } else if (parsed.isOpen === false) {
      return `<div class="r-hours">
        <span class="hours-badge closed">🔴 ${parsed.label}</span>
        <span class="hours-detail">${parsed.detail}</span>
      </div>`;
    } else {
      return `<div class="r-hours">
        <span class="hours-badge unknown">⏰ ${parsed.raw}</span>
      </div>`;
    }
  },

  _render() {
    const grid = document.getElementById('restaurantGrid');
    const visible = State.visibleResults;
    if (visible.length === 0) {
      const q = (State.activeDish || '').trim();
      if (q) {
        // Couldn't resolve the typed query → offer a Google Maps search,
        // whose autocomplete finds nearby places our data misses ("coo").
        const esc = escapeHtml(q);
        grid.innerHTML = `<div class="empty-state">
          <div class="es-icon">🔍</div>
          <div class="es-msg">${I18N.t('empty.notFound', { q: `<b>${esc}</b>` })}<br>
            <span style="font-size:.82rem;opacity:.75">${I18N.t('empty.tapBelow')}</span>
          </div>
          <a class="es-gmaps-btn" href="${gmapsSearchUrl(q)}" target="_blank" rel="noopener">${I18N.t('empty.findOnMaps', { q: esc })}</a>
        </div>`;
      } else {
        grid.innerHTML = `<div class="empty-state"><div class="es-icon">🍽️</div><div class="es-msg">${I18N.t('empty.noneInCategory')}</div></div>`;
      }
      return;
    }
    // When we're showing generic fallback results for an unmatched query,
    // put a Google Maps search banner on top so the user can still reach
    // the exact place they typed (Google autocompletes obscure names).
    // Gemini often returns plausible-but-wrong near-matches for an obscure
    // name (typing "coo" yields "Coo Coffee", not the user's "Coo.chan"),
    // so ALWAYS offer a Google Maps search for any typed query — the exact
    // place is one tap away even when our result isn't the right one.
    let bannerHtml = '';
    const q = (State.activeDish || '').trim();
    if (q) {
      const esc = String(q).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      // NOTE: .es-gmaps-banner is display:flex — a flex container with
      // mixed text nodes AND an element child (the <b> here) wraps each
      // text run in its own anonymous flex item, splitting the sentence
      // into fragments that lay out independently (looked broken/garbled
      // on real devices). Wrapping everything in one <span> keeps it as
      // ordinary inline content instead — a single flex item.
      bannerHtml = `<a class="es-gmaps-banner" href="${gmapsSearchUrl(q)}" target="_blank" rel="noopener">
        <span>${I18N.t('banner.wrongResult', { q: `<b>${esc}</b>` })}</span>
      </a>`;
    }
    grid.innerHTML = bannerHtml + visible.map((r, i) => {
      const cat = CATEGORIES[r.cat];
      const sel = State.selected.has(r.id);
      const userAdded = r.id >= 1001 && r.id < 1e12;
      const isGemini = !!r._gemini;
      const isOsm = r.id >= 1e13 && !isGemini;
      const flagCls = userAdded ? ' user-added' : (isGemini ? ' gemini-added' : (isOsm ? ' osm-added' : ''));
      const priceLabel = r.price && r.price !== '—' ? `💰 ${r.price}` : '💰 —';
      // No real rating for OSM-sourced places — show a neutral "no data"
      // dash (matches the existing '💰 —' convention below) instead of
      // naming the data source; that stays dev-only (osm-added CSS class
      // + console.debug in scan()), never surfaced as text to users.
      const ratingLabel = isGemini ? `${r.rating.toFixed(1)} ★` : (isOsm ? '★ —' : `${r.rating} ★`);
      const hoursBadge = this._renderHoursBadge(r);
      return `<div class="r-card${sel?' selected':''}${flagCls}" data-id="${r.id}" style="animation-delay:${Math.min(i,10)*30}ms" role="button" tabindex="0" title="${I18N.t('card.tapDetail')}">
        <button class="r-check" data-id="${r.id}" title="${I18N.t('card.selectAdd')}" aria-label="${I18N.t('card.select')}" aria-pressed="${sel?'true':'false'}">✓</button>
        <div class="r-cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${cat.label}</div>
        <div class="r-name">${escapeHtml(r.name)}</div>
        ${hoursBadge}
        <div class="r-price">${priceLabel}</div>
        <div class="r-desc">${escapeHtml(r.desc)}</div>
        <div class="r-meta">
          <span class="r-rating">${ratingLabel}</span>
          <span class="r-dist">${fmtDist(r._dist)}</span>
        </div>
      </div>`;
    }).join('');
    this._updatePlanBtn();
  },
  _updatePlanBtn() {
    const n = State.selected.size;
    const btn = document.getElementById('planBtn');
    btn.disabled = n === 0;
    btn.textContent = n === 0 ? I18N.t('results.schedule') : I18N.t('results.scheduleN', { n });
  },
  init() {
    document.getElementById('resultsBack').addEventListener('click', () => {
      document.getElementById('homeScreen').classList.remove('hidden');
      document.getElementById('resultsScreen').classList.add('hidden');
      setTimeout(() => State.mainMap?.invalidateSize(), 60);
    });
    document.getElementById('reshuffleBtn').addEventListener('click', () => {
      // Long-press / second tap within 600ms → clear cache and force re-scan
      const now = Date.now();
      if (now - (this._lastShuffle || 0) < 600) {
        HomeCtrl._scanCache.delete(HomeCtrl._cacheKey());
        document.getElementById('resultsScreen').classList.add('hidden');
        document.getElementById('homeScreen').classList.remove('hidden');
        showToast(I18N.t('toast.rescanning'));
        setTimeout(() => HomeCtrl.scan(), 200);
        return;
      }
      this._lastShuffle = now;
      State.filteredResults = shuffle(State.filteredResults);
      this._applyFilters();
      showToast(I18N.t('toast.reshuffleHint'));
    });
    document.getElementById('catTabs').addEventListener('click', e => {
      const tab = e.target.closest('.cat-tab');
      if (!tab) return;
      this._setTabFilter(tab.dataset.filter);
    });
    document.getElementById('restaurantGrid').addEventListener('click', e => {
      const card = e.target.closest('.r-card');
      if (!card) return;
      const id = parseInt(card.dataset.id);
      const check = e.target.closest('.r-check');

      if (check) {
        // Tick corner → toggle selection (independent of the card body)
        e.stopPropagation();
        const nowSelected = !State.selected.has(id);
        if (nowSelected) {
          if (State.selected.size >= 6) { showToast(I18N.t('toast.maxSelected')); return; }
          State.selected.add(id);
          card.classList.add('selected');
        } else {
          State.selected.delete(id);
          card.classList.remove('selected');
        }
        check.setAttribute('aria-pressed', nowSelected ? 'true' : 'false');
        this._updatePlanBtn();
        return;
      }

      // Card body → open detail modal
      const r = State.filteredResults.find(x => x.id === id)
        || (Array.isArray(State.results) ? State.results.find(x => x.id === id) : null);
      if (r) DetailModal.open(r);
    });

    document.getElementById('restaurantGrid').addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.r-card');
      if (!card || e.target.closest('.r-check')) return;
      e.preventDefault();
      const id = parseInt(card.dataset.id);
      const r = State.filteredResults.find(x => x.id === id);
      if (r) DetailModal.open(r);
    });
    document.getElementById('planBtn').addEventListener('click', () => {
      PlanCtrl._returnTo = 'results';
      PlanCtrl.buildItinerary();
      PlanCtrl.show();
    });
  },
};

/* ═══════════════════════════════════════════════
   PLAN CONTROLLER
═══════════════════════════════════════════════ */
const PlanCtrl = {
  // 'results' (mặc định) hay 'profile' — planBack quay lại đúng màn đã
  // vào từ đó (bấm "Đi lại" ở lịch sử chuyến ăn vào thẳng đây, không qua
  // màn Kết quả, nên phải nhớ để nút Quay lại trả đúng chỗ).
  _returnTo: 'results',

  // customStops (tuỳ chọn): dùng khi "đi lại" 1 chuyến cũ — dữ liệu tự lấy
  // từ chính chuyến đó (đã lưu đủ id/tên/toạ độ/loại) thay vì tra lại
  // State.selected + allRestaurants(), vì id của kết quả AI (Gemini) chỉ
  // dùng 1 lần, lần quét sau sẽ không còn khớp id cũ nữa.
  buildItinerary(customStops) {
    const stops = customStops
      ? customStops.map(r => ({ ...r, _dist: haversine(State.userLat, State.userLng, r.lat, r.lng) }))
      : allRestaurants()
          .filter(r => State.selected.has(r.id))
          .map(r => ({ ...r, _dist: haversine(State.userLat, State.userLng, r.lat, r.lng) }));

    let current = { lat: State.userLat, lng: State.userLng };
    const ordered = [];
    const remaining = [...stops];
    while (remaining.length) {
      let nearest = null, nearestDist = Infinity, nearestIdx = -1;
      remaining.forEach((r, i) => {
        const d = haversine(current.lat, current.lng, r.lat, r.lng);
        if (d < nearestDist) { nearestDist = d; nearest = r; nearestIdx = i; }
      });
      ordered.push({ ...nearest, _legDist: nearestDist });
      current = nearest;
      remaining.splice(nearestIdx, 1);
    }

    let clock = new Date();
    clock.setSeconds(0, 0);
    const extra = (5 - clock.getMinutes()%5) % 5;
    clock = addMinutes(clock, extra);

    State.itinerary = ordered.map(stop => {
      const travelMin = travelMinutes(stop._legDist);
      const arrivalClock = addMinutes(clock, travelMin);
      const dwell = State.dwellOverrides[stop.id] ?? CATEGORIES[stop.cat].dwell;
      const departureClock = addMinutes(arrivalClock, dwell);
      const entry = {
        ...stop, travelMin,
        arrivalClock: new Date(arrivalClock),
        departureClock: new Date(departureClock),
        dwell,
      };
      clock = departureClock;
      return entry;
    });

    // Log trip to history so the profile's CHUYẾN ĂN stat can show
    // where the user has been. Skip if this is identical to the most
    // recent trip within the last 5 minutes (e.g. reshuffle click).
    const trip = {
      id: Date.now(),
      at: new Date().toISOString(),
      stops: State.itinerary.map(s => ({
        id: s.id, name: s.name, cat: s.cat, price: s.price,
        address: s.address || null, lat: s.lat, lng: s.lng,
      })),
    };
    const history = State.profile.tripHistory || (State.profile.tripHistory = []);
    const last = history[0];
    const FIVE_MIN = 5 * 60 * 1000;
    const sameStops = last
      && (Date.now() - new Date(last.at).getTime() < FIVE_MIN)
      && last.stops.length === trip.stops.length
      && last.stops.every((s, i) => s.id === trip.stops[i].id);
    if (!sameStops) {
      history.unshift(trip);
      // Cap at 50 most-recent so localStorage doesn't grow forever
      if (history.length > 50) history.length = 50;
      State.profile.trips = history.length;
    }
    Storage.save();
  },

  show() {
    // Hide every top-level screen unconditionally (not just Results) —
    // this can now also be entered straight from Cá nhân via replayTrip(),
    // which never passes through Results at all.
    document.getElementById('homeScreen').classList.add('hidden');
    document.getElementById('resultsScreen').classList.add('hidden');
    document.getElementById('profileScreen').classList.add('hidden');
    document.getElementById('communityScreen').classList.add('hidden');
    document.getElementById('planScreen').classList.remove('hidden');
    this._renderSummary();
    this._renderTimeline();
    this._initPlanMap();
  },

  // "Đi lại" 1 chuyến đã đi (tab Cá nhân → Chuyến ăn đã đi) — giữ nguyên
  // thứ tự/danh sách quán, chỉ tính lại giờ giấc + lộ trình xuất phát từ
  // vị trí GPS hiện tại thay vì điểm xuất phát của lần đó.
  replayTrip(trip) {
    if (State.userLat == null || State.userLng == null) {
      showToast(I18N.t('trips.needGps'));
      return;
    }
    this._returnTo = 'profile';
    this.buildItinerary(trip.stops.map(s => ({ ...s })));
    this.show();
  },

  _renderSummary() {
    const totalTravel = State.itinerary.reduce((s,x) => s+x.travelMin, 0);
    const totalDwell  = State.itinerary.reduce((s,x) => s+x.dwell, 0);
    const totalDist   = State.itinerary.reduce((s,x) => s+x._legDist, 0);
    const endTime     = State.itinerary.length ? State.itinerary[State.itinerary.length-1].departureClock : new Date();
    const startTime   = State.itinerary.length ? addMinutes(State.itinerary[0].arrivalClock, -State.itinerary[0].travelMin) : new Date();

    document.getElementById('planSummary').innerHTML = `
      <div class="sum-chip"><span class="sci">🏪</span>${I18N.t('plan.stops', { n: State.itinerary.length })}</div>
      <div class="sum-chip"><span class="sci">🕐</span>${fmtClock(startTime)} → ${fmtClock(endTime)}</div>
      <div class="sum-chip"><span class="sci">⏱</span>${fmtTime(totalTravel+totalDwell)}</div>
      <div class="sum-chip"><span class="sci">📍</span>${fmtDist(totalDist)}</div>
      <div class="sum-chip"><span class="sci">🛵</span>${I18N.t('plan.motorbike')}</div>
    `;
  },

  _renderHoursWarning(stop) {
    if (!stop.hours) return '';
    const parsed = parseOpeningHours(stop.hours);
    if (!parsed || parsed.isOpen !== false) return '';
    return `<div class="tl-hours-warn">${I18N.t('plan.hoursWarn', { detail: parsed.detail })}</div>`;
  },

  _renderTimeline() {
    const tl = document.getElementById('timeline');
    let html = '';

    html += `<div class="tl-item">
      <div class="tl-spine"><div class="tl-dot" style="background:#F8DFD3;border-color:#B92626;font-size:.85rem">📍</div><div class="tl-line"></div></div>
      <div class="tl-content"><div class="tl-start">${I18N.t('plan.depart', { time: fmtClock(addMinutes(State.itinerary[0].arrivalClock, -State.itinerary[0].travelMin)) })}</div></div>
    </div>`;

    State.itinerary.forEach((stop, i) => {
      const cat = CATEGORIES[stop.cat];
      const isLast = i === State.itinerary.length-1;
      const hoursWarn = this._renderHoursWarning(stop);

      html += `<div class="tl-item">
        <div class="tl-spine"><div class="tl-dot" style="font-size:.85rem">🛵</div><div class="tl-line"></div></div>
        <div class="tl-content">
          <div class="tl-travel">
            <span class="tl-travel-icon">🛵</span>
            <div class="tl-travel-info">
              <div class="tl-travel-time">${I18N.t('plan.travelMin', { min: stop.travelMin })}</div>
              <div class="tl-travel-dist">${I18N.t('plan.distMoto', { dist: fmtDist(stop._legDist) })}</div>
            </div>
          </div>
        </div>
      </div>`;

      html += `<div class="tl-item">
        <div class="tl-spine">
          <div class="tl-dot" style="background:${cat.color}22;border-color:${cat.color}">${cat.icon}</div>
          ${!isLast ? '<div class="tl-line"></div>' : ''}
        </div>
        <div class="tl-content">
          <div class="tl-stop" data-idx="${i}">
            <div class="tl-stop-header">
              <div class="tl-stop-icon">${cat.icon}</div>
              <div class="tl-stop-info">
                <div class="tl-stop-name">${escapeHtml(stop.name)}</div>
                <div class="tl-stop-cat" style="color:${cat.color}">${cat.label} · ${stop.price}</div>
              </div>
            </div>
            ${hoursWarn}
            <div class="tl-dwell">
              <span class="dwell-label">${I18N.t('plan.dwellLabel')}</span>
              <div class="dwell-adj">
                <button class="dwell-btn" data-action="minus" data-idx="${i}">−</button>
                <span class="dwell-num" id="dwell${i}">${I18N.t('plan.minAbbr', { n: stop.dwell })}</span>
                <button class="dwell-btn" data-action="plus" data-idx="${i}">+</button>
              </div>
            </div>
            <div class="tl-time" id="stopTime${i}">${I18N.t('plan.arriveDepart', { a: fmtClock(stop.arrivalClock), b: fmtClock(stop.departureClock) })}</div>
            <a href="${gmapsUrl(stop)}"
               target="_blank" rel="noopener" class="r-gmaps-link" style="margin-top:8px">
               ${I18N.t('common.openMaps')}
            </a>
          </div>
        </div>
      </div>`;
    });

    if (State.itinerary.length) {
      const last = State.itinerary[State.itinerary.length-1];
      html += `<div class="tl-item">
        <div class="tl-spine"><div class="tl-dot" style="background:#FFF3B0;border-color:#B98A00;font-size:.85rem">🏁</div></div>
        <div class="tl-content"><div class="tl-start" style="color:#B98A00" id="endTimeNode">${I18N.t('plan.endTrip', { time: fmtClock(last.departureClock) })}</div></div>
      </div>`;
    }

    tl.innerHTML = html;

    tl.addEventListener('click', e => {
      const btn = e.target.closest('.dwell-btn');
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx);
      const action = btn.dataset.action;
      const stop = State.itinerary[idx];
      let dwell = stop.dwell + (action==='plus' ? 5 : -5);
      dwell = Math.max(5, Math.min(180, dwell));
      State.dwellOverrides[stop.id] = dwell;
      stop.dwell = dwell;

      let clock = stop.departureClock;
      for (let i = idx; i < State.itinerary.length; i++) {
        const s = State.itinerary[i];
        if (i === idx) {
          s.departureClock = addMinutes(s.arrivalClock, s.dwell);
          clock = s.departureClock;
        } else {
          s.arrivalClock = addMinutes(clock, s.travelMin);
          s.departureClock = addMinutes(s.arrivalClock, s.dwell);
          clock = s.departureClock;
        }
        const dwellEl = document.getElementById(`dwell${i}`);
        const timeEl = document.getElementById(`stopTime${i}`);
        if (dwellEl) dwellEl.textContent = I18N.t('plan.minAbbr', { n: s.dwell });
        if (timeEl) timeEl.textContent = I18N.t('plan.arriveDepart', { a: fmtClock(s.arrivalClock), b: fmtClock(s.departureClock) });
      }
      const endNode = document.getElementById('endTimeNode');
      if (endNode) {
        const last = State.itinerary[State.itinerary.length-1];
        endNode.textContent = I18N.t('plan.endTrip', { time: fmtClock(last.departureClock) });
      }
      this._renderSummary();
    });
  },

  _initPlanMap() {
    if (State.planMap) { try { State.planMap.remove(); } catch(_){} State.planMap = null; }
    const stops = State.itinerary;
    if (!stops.length) return;

    const allPts = [[State.userLat, State.userLng], ...stops.map(s => [s.lat, s.lng])];
    const bounds = L.latLngBounds(allPts);

    // Interactive map — user can pan/zoom to inspect the route
    State.planMap = L.map('planMap', {
      zoomControl: false, attributionControl: false,
      dragging: true, scrollWheelZoom: true, touchZoom: true, doubleClickZoom: true,
    });
    TileLayer.add(State.planMap);
    State.planMap.fitBounds(bounds.pad(0.25));

    // Start marker
    const startIcon = L.divIcon({
      html: `<div class="user-marker-inner"></div>`,
      iconSize: [18,18], iconAnchor: [9,9], className: '',
    });
    L.marker([State.userLat, State.userLng], { icon: startIcon }).addTo(State.planMap);

    // Numbered stop markers
    stops.forEach((s, i) => {
      const cat = CATEGORIES[s.cat];
      const icon = L.divIcon({
        html: `<div class="r-map-marker" style="background:${cat.color}">${i+1}</div>`,
        iconSize: [32,32], iconAnchor: [16,16], className: '',
      });
      L.marker([s.lat, s.lng], { icon }).addTo(State.planMap);
    });

    // Draw straight-line fallback immediately so map isn't empty while routing loads
    const fallbackLine = L.polyline(allPts, {
      color: '#B92626', weight: 3, opacity: .55, dashArray: '7,5',
    }).addTo(State.planMap);

    // Overlay controls: zoom + fit + locate + fullscreen
    const wrap = document.getElementById('planMapWrap');
    wrap.classList.remove('fullscreen'); // start collapsed on every rebuild
    PlanCtrl._stopLiveTracking(); // clean up any previous watch
    let ctrl = wrap.querySelector('.pmap-controls');
    if (ctrl) ctrl.remove();
    ctrl = document.createElement('div');
    ctrl.className = 'pmap-controls';
    ctrl.innerHTML = `
      <button class="pmap-btn" id="pmapZoomIn" title="${I18N.t('pmap.zoomIn')}">＋</button>
      <button class="pmap-btn" id="pmapZoomOut" title="${I18N.t('pmap.zoomOut')}">－</button>
      <button class="pmap-btn pmap-fit" id="pmapFit" title="${I18N.t('pmap.fitRoute')}">⤢</button>
      <button class="pmap-btn pmap-locate" id="pmapLocate" title="${I18N.t('pmap.myLocation')}">📍</button>
      <button class="pmap-btn pmap-fs" id="pmapFs" title="${I18N.t('pmap.fullscreen')}">⛶</button>
    `;
    wrap.appendChild(ctrl);
    document.getElementById('pmapZoomIn').addEventListener('click', () => State.planMap.zoomIn());
    document.getElementById('pmapZoomOut').addEventListener('click', () => State.planMap.zoomOut());
    document.getElementById('pmapFit').addEventListener('click', () => State.planMap.fitBounds(bounds.pad(0.25)));
    document.getElementById('pmapLocate').addEventListener('click', () => PlanCtrl._centerOnMe());
    document.getElementById('pmapFs').addEventListener('click', () => PlanCtrl._toggleFullscreen());

    // Primary "Bắt đầu" navigation button — only visible in fullscreen.
    // Cute Google-Maps-style pill with a rounded navigation arrow.
    const oldStart = wrap.querySelector('.pmap-start-btn');
    if (oldStart) oldStart.remove();
    const startBtn = document.createElement('button');
    startBtn.className = 'pmap-start-btn';
    startBtn.id = 'pmapStart';
    startBtn.type = 'button';
    startBtn.setAttribute('aria-label', I18N.t('nav.startAria'));
    startBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true">
        <path d="M12 3.2c-.5 0-1 .3-1.2.85L4 20.2c-.35.85.55 1.65 1.35 1.2L12 17.7l6.65 3.7c.8.45 1.7-.35 1.35-1.2L13.2 4.05C13 3.5 12.5 3.2 12 3.2Z"
              fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>
      <span>Bắt đầu</span>
    `;
    wrap.appendChild(startBtn);
    startBtn.addEventListener('click', () => PlanCtrl._startNav());

    // Fetch real road route from OSRM (free, no key needed)
    // Coords format: lng,lat;lng,lat;...
    const osrmCoords = allPts.map(([la, lo]) => `${lo},${la}`).join(';');
    fetch(`https://router.project-osrm.org/route/v1/driving/${osrmCoords}?overview=full&geometries=geojson`)
      .then(r => r.json())
      .then(data => {
        const geom = data.routes?.[0]?.geometry;
        if (!geom) return;
        // Remove fallback dashed line, draw real road route
        fallbackLine.remove();
        L.geoJSON(geom, {
          style: { color: '#B92626', weight: 4.5, opacity: .9, lineJoin: 'round', lineCap: 'round' },
        }).addTo(State.planMap);
      })
      .catch(() => {
        // Keep the fallback dashed line — no-op on error
      });
  },

  init() {
    document.getElementById('planBack').addEventListener('click', () => {
      this._stopLiveTracking();
      document.getElementById('planMapWrap')?.classList.remove('fullscreen');
      document.getElementById('planScreen').classList.add('hidden');
      if (this._returnTo === 'profile') {
        document.getElementById('profileScreen').classList.remove('hidden');
        ProfileCtrl.render();
      } else {
        document.getElementById('resultsScreen').classList.remove('hidden');
      }
    });
    // Esc exits fullscreen
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const wrap = document.getElementById('planMapWrap');
        if (wrap?.classList.contains('fullscreen')) this._toggleFullscreen();
      }
    });
  },

  // ── Fullscreen + live tracking ────────────────────────────────────────
  _watchId: null,
  _liveMarker: null,
  _liveCircle: null,

  _toggleFullscreen() {
    const wrap = document.getElementById('planMapWrap');
    if (!wrap || !State.planMap) return;
    const btn = document.getElementById('pmapFs');
    const isFs = wrap.classList.toggle('fullscreen');
    // Slide the marquee ribbon and bottom tab bar out of view so the
    // map has the whole viewport. The class hook on <body> is what
    // the CSS transform rules key off of.
    document.body.classList.toggle('map-full', isFs);
    if (btn) {
      btn.textContent = isFs ? '✕' : '⛶';
      btn.title = isFs ? I18N.t('nav.exitFullscreen') : I18N.t('nav.fullscreen');
    }
    // Leaflet needs to recompute size after the container resizes;
    // wait past the ribbon/tabbar slide (0.32s) before invalidating
    // so the map fills the newly-freed pixels in one pass.
    setTimeout(() => State.planMap.invalidateSize(), 340);
    if (isFs) {
      this._startLiveTracking();
      showToast(I18N.t('toast.trackingRealtime'));
    } else {
      this._stopLiveTracking();
    }
  },

  _centerOnMe() {
    if (!State.planMap) return;
    // If we already have a fix, jump there immediately.
    if (State.userLat != null && State.userLng != null) {
      State.planMap.setView([State.userLat, State.userLng], 17);
    }
    // Kick off (or refresh) the live watch — user asking to be located
    // is a signal they want continuous updates.
    this._startLiveTracking();
    document.getElementById('pmapLocate')?.classList.add('tracking');
  },

  // Google-Maps-style "Bắt đầu": start live GPS, zoom to user, and tell
  // them how far the nearest planned stop is so they know where they're
  // heading. Idempotent — pressing again just re-centers.
  _startNav() {
    if (!State.planMap) return;
    // Make sure we're in fullscreen so the map is actually usable
    const wrap = document.getElementById('planMapWrap');
    if (wrap && !wrap.classList.contains('fullscreen')) this._toggleFullscreen();
    this._startLiveTracking();

    if (State.userLat == null || State.userLng == null) {
      showToast(I18N.t('toast.fetchingGps'));
      return;
    }
    State.planMap.setView([State.userLat, State.userLng], 17);

    // Find the nearest planned stop, hint the distance in the toast so
    // the user has a target as they set off.
    const stops = State.selected instanceof Set
      ? [...State.selected].map(id =>
          (State.results || []).find(r => r.id === id) ||
          (State.userRestaurants || []).find(r => r.id === id)
        ).filter(s => s && s.lat != null && s.lng != null)
      : [];
    if (stops.length) {
      let nearest = null, minD = Infinity;
      for (const s of stops) {
        const d = this._haversineKm(State.userLat, State.userLng, s.lat, s.lng);
        if (d < minD) { minD = d; nearest = s; }
      }
      if (nearest) {
        const label = minD < 1
          ? `${Math.round(minD * 1000)}m`
          : `${minD.toFixed(1)}km`;
        showToast(I18N.t('toast.navigatingTo', { name: nearest.name, label }));
      } else {
        showToast(I18N.t('toast.followBlueDot'));
      }
    } else {
      showToast(I18N.t('toast.followBlueDot'));
    }
  },

  _haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },

  _startLiveTracking() {
    if (this._watchId != null) return;
    if (!navigator.geolocation) { showToast(I18N.t('toast.gpsNotSupported')); return; }
    this._watchId = navigator.geolocation.watchPosition(
      pos => this._onLiveFix(pos),
      err => {
        const msgs = {1: I18N.t('gps2.err.denied'), 2: I18N.t('gps2.err.unavailable'), 3: I18N.t('gps2.err.timeout')};
        showToast(msgs[err.code] || I18N.t('gps.err.generic'));
        this._stopLiveTracking();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
    );
  },

  _stopLiveTracking() {
    if (this._watchId != null) {
      try { navigator.geolocation.clearWatch(this._watchId); } catch (_) {}
      this._watchId = null;
    }
    if (this._liveMarker) { try { this._liveMarker.remove(); } catch (_) {} this._liveMarker = null; }
    if (this._liveCircle) { try { this._liveCircle.remove(); } catch (_) {} this._liveCircle = null; }
    document.getElementById('pmapLocate')?.classList.remove('tracking');
  },

  _onLiveFix(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    State.userLat = lat; State.userLng = lng;
    if (!State.planMap) return;
    if (!this._liveMarker) {
      const icon = L.divIcon({
        html: '<div class="user-marker-inner tracking"></div>',
        iconSize: [18, 18], iconAnchor: [9, 9], className: '',
      });
      this._liveMarker = L.marker([lat, lng], { icon, zIndexOffset: 2000 }).addTo(State.planMap);
    } else {
      this._liveMarker.setLatLng([lat, lng]);
    }
    if (accuracy > 0) {
      if (!this._liveCircle) {
        this._liveCircle = L.circle([lat, lng], {
          radius: accuracy, color: '#4CAF50', fillColor: '#4CAF50',
          fillOpacity: .12, weight: 1.5, opacity: .55, interactive: false,
        }).addTo(State.planMap);
      } else {
        this._liveCircle.setLatLng([lat, lng]).setRadius(accuracy);
      }
    }
  },
};

/* ═══════════════════════════════════════════════
   PROFILE CONTROLLER
═══════════════════════════════════════════════ */
const ProfileCtrl = {
  init() {
    // Avatar giờ chỉ mở modal Tài khoản (đổi ava/tên/bạn bè/đăng xuất đều
    // gom vào đây) thay vì tự cycle avatar ngay khi chạm.
    document.getElementById('avatarBtn').addEventListener('click', () => {
      this._openAccountModal();
    });
    this._initAccountModal();

    const nameInput = document.getElementById('profileNameInput');
    nameInput.addEventListener('input', () => {
      State.profile.name = nameInput.value;
      document.getElementById('profileNameDisplay').textContent = nameInput.value || I18N.t('profile.namePlaceholder');
      Storage.save();
    });

    document.getElementById('prefChips').addEventListener('click', e => {
      const chip = e.target.closest('.pref-chip');
      if (!chip) return;
      const p = chip.dataset.pref;
      if (State.profile.prefs.has(p)) {
        State.profile.prefs.delete(p);
        chip.classList.remove('active');
      } else {
        State.profile.prefs.add(p);
        chip.classList.add('active');
      }
      Storage.save();
      this._renderStats();
    });

    // Đăng quán mới giờ chỉ làm ở tab Cộng đồng — tab này chỉ xem/sửa/xoá quán
    // đã đăng, kết bạn, và thông tin tài khoản.
    document.getElementById('communityLogout').addEventListener('click', () => {
      Community.logout();
      showToast(I18N.t('toast.loggedOut'));
      this.render();
    });

    document.getElementById('myRFilterChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.cat-chip');
      if (!chip) return;
      document.querySelectorAll('#myRFilterChips .cat-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      this._myRFilter = chip.dataset.filter;
      this._renderMyRestaurants();
    });

    // Stat cards — clickable overview shortcuts
    document.querySelectorAll('.stat-card[data-stat]').forEach(card => {
      const handle = () => this._onStatClick(card.dataset.stat);
      card.addEventListener('click', handle);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handle(); }
      });
    });

    // Export / Import
    document.getElementById('exportDataBtn').addEventListener('click', () => {
      Storage.exportJSON();
    });
    document.getElementById('importDataBtn').addEventListener('click', () => {
      document.getElementById('importFileInput').click();
    });
    document.getElementById('importFileInput').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const ok = Storage.importJSON(ev.target.result);
        if (ok) this.render();
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // ── Gemini API key ────────────────────────────────────────────────
    const keyInput = document.getElementById('geminiKeyInput');
    const keyToggle = document.getElementById('geminiKeyToggle');
    const keySave = document.getElementById('geminiKeySave');
    const keyClear = document.getElementById('geminiKeyClear');

    if (keyToggle && keyInput) {
      keyToggle.addEventListener('click', () => {
        keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      });
    }
    if (keySave && keyInput) {
      keySave.addEventListener('click', () => {
        const v = keyInput.value.trim();
        if (!v) { showToast(I18N.t('toast.pasteKeyFirst')); return; }
        if (v.length < 20) { showToast(I18N.t('toast.keyTooShort')); return; }
        Gemini.userKey = v;
        keyInput.value = '';
        HomeCtrl._scanCache?.clear?.();
        this._renderAiStatus();
        showToast(I18N.t('toast.customKeySaved'));
      });
    }
    if (keyClear) {
      keyClear.addEventListener('click', () => {
        Gemini.clearKey();
        if (keyInput) keyInput.value = '';
        HomeCtrl._scanCache?.clear?.();
        this._renderAiStatus();
        showToast(I18N.t('toast.defaultKeyRestored'));
      });
    }
  },

  _renderAiStatus() {
    const el = document.getElementById('aiStatus');
    if (!el) return;
    const custom = Gemini.usingCustomKey();
    const hasDefault = !!Gemini.defaultKey;
    if (custom) {
      el.textContent = I18N.t('ai.customKey');
      el.style.color = '#2e9e5b';
    } else if (hasDefault) {
      el.textContent = I18N.t('ai.defaultKey');
      el.style.color = '#B92626';
    } else {
      el.textContent = I18N.t('ai.noKey');
      el.style.color = '#999';
    }
  },

  _myRFilter: 'all',
  _myRestaurants: [], // cache của lần fetch gần nhất, để lọc client-side không gọi lại API

  // ── Modal Tài khoản (avatar picker, tên, bạn bè, đăng xuất) ─────────────
  _initAccountModal() {
    const modal = document.getElementById('accountModal');
    document.getElementById('accountModalClose').addEventListener('click', () => modal.classList.remove('show'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('show')) modal.classList.remove('show');
    });

    const picker = document.getElementById('avatarPicker');
    picker.innerHTML = AVATARS.map(a => `<button type="button" class="avatar-pick-btn" data-avatar="${a}">${a}</button>`).join('');
    picker.addEventListener('click', e => {
      const btn = e.target.closest('.avatar-pick-btn');
      if (!btn) return;
      const a = btn.dataset.avatar;
      State.profile.avatar = a;
      document.getElementById('avatarBtn').textContent = a;
      picker.querySelectorAll('.avatar-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.avatar === a));
      Storage.save();
      // Best-effort push to the server too — the picker used to be
      // localStorage-only, so other people's feed/profile views had no way
      // to see your chosen avatar. Silent no-op if not logged in.
      if (Community.isLoggedIn()) Community.updateAvatar(a);
    });

    // Ngôn ngữ — đổi xong áp lại bản dịch + báo cho các màn đang render
    // (Cộng đồng/Cá nhân) tự vẽ lại phần chữ động bằng ngôn ngữ mới.
    const langPicker = document.getElementById('langPicker');
    langPicker.querySelectorAll('.cat-pick-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === I18N.lang);
    });
    langPicker.addEventListener('click', e => {
      const btn = e.target.closest('.cat-pick-btn');
      if (!btn || btn.dataset.lang === I18N.lang) return;
      I18N.lang = btn.dataset.lang;
      I18N.apply();
      langPicker.querySelectorAll('.cat-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === I18N.lang));
      document.dispatchEvent(new CustomEvent('i18n:changed'));
    });
  },

  _openAccountModal() {
    document.querySelectorAll('#avatarPicker .avatar-pick-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.avatar === State.profile.avatar);
    });
    document.getElementById('accountModal').classList.add('show');
  },

  render() {
    document.getElementById('avatarBtn').textContent = State.profile.avatar;
    document.getElementById('profileNameInput').value = State.profile.name;
    document.getElementById('profileNameDisplay').textContent = State.profile.name || I18N.t('profile.namePlaceholder');
    document.querySelectorAll('.pref-chip').forEach(c => {
      c.classList.toggle('active', State.profile.prefs.has(c.dataset.pref));
    });
    this._renderStats();
    this._renderAiStatus();

    const loggedIn = Community.isLoggedIn();
    document.getElementById('profileLoggedOutHint').classList.toggle('hidden', loggedIn);
    document.getElementById('profileLoggedIn').classList.toggle('hidden', !loggedIn);
    if (loggedIn) {
      const user = Community.currentUser;
      document.getElementById('communityWelcome').innerHTML = I18N.t('account.helloName', { name: escapeHtml(user.name || user.email) });
      CommunityCtrl._renderFriends();
    }
    this._loadMyRestaurants();
  },

  _renderStats() {
    document.getElementById('statTrips').textContent = State.profile.trips;
    const catPrefs = [...State.profile.prefs].filter(p => CATEGORIES[p]);
    const fav = catPrefs[0] ? CATEGORIES[catPrefs[0]].icon : '🍽️';
    document.getElementById('statFav').textContent = fav;
    // statMyR / statScore được _loadMyRestaurants() cập nhật (phụ thuộc dữ liệu server)
  },

  _onStatClick(stat) {
    if (stat === 'myR' || stat === 'score') {
      document.getElementById('myRestaurantList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (stat === 'trips') {
      HistoryModal.openTrips();
    } else if (stat === 'fav') {
      const catPrefs = [...State.profile.prefs].filter(p => CATEGORIES[p]);
      if (catPrefs.length === 0) {
        showToast(I18N.t('toast.pickCatBelow'));
      } else {
        const labels = catPrefs.map(p => CATEGORIES[p].label).join(', ');
        showToast(I18N.t('toast.favLabels', { labels }));
      }
      document.getElementById('prefChips')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },

  // ── Quán tôi đã đăng lên cộng đồng — xem/lọc/sửa/xoá ─────────────────────
  async _loadMyRestaurants() {
    const list = document.getElementById('myRestaurantList');
    if (!Community.isLoggedIn()) {
      document.getElementById('statMyR').textContent = '0';
      document.getElementById('statScore').textContent = '0';
      list.innerHTML = `<div class="empty-my-r">
        <div class="em-icon">📝</div>
        <div class="em-msg">${I18N.t('em.notLoggedIn')}</div>
        <div class="em-sub">${I18N.t('em.signInToSeeYours')}</div>
      </div>`;
      return;
    }
    list.innerHTML = `<div class="empty-my-r"><div class="em-icon">⏳</div><div class="em-msg">${I18N.t('em.loading')}</div></div>`;
    const r = await Community.myRestaurants();
    this._myRestaurants = r.ok ? r.data.items : [];
    document.getElementById('statMyR').textContent = this._myRestaurants.length;
    this._myFollowerCount = await Community.followerCount(Community.currentUser.id);
    this._renderMyRestaurants();
    this._loadMyScore();
  },

  async _loadMyScore() {
    const counts = await Promise.all(this._myRestaurants.map(r => Community.voteCount(r.id)));
    const total = counts.reduce((a, b) => a + b, 0);
    this._myStarTotal = total;
    const el = document.getElementById('statScore');
    if (el) el.textContent = total;
    // Header was already drawn with a "…" placeholder star count before this
    // resolved (votes need their own round-trip per restaurant) — patch it
    // in now that the real total is known.
    const headerStat = document.querySelector('#myRestaurantList .social-stat span[data-star-total]');
    if (headerStat) headerStat.textContent = total;
  },

  _renderMyRestaurants() {
    const list = document.getElementById('myRestaurantList');
    const items = this._myRFilter === 'all'
      ? this._myRestaurants
      : this._myRestaurants.filter(r => COMMUNITY_PB_TO_CAT[r.category] === this._myRFilter);

    const header = communityProfileHeaderHtml({
      avatar: State.profile.avatar,
      name: Community.currentUser?.name || State.profile.name || I18N.t('profile.namePlaceholder'),
      tagline: I18N.t('profile.tagline'),
      postCount: this._myRestaurants.length,
      starCount: `<span data-star-total>${this._myStarTotal ?? '···'}</span>`,
      followerCount: this._myFollowerCount ?? '···',
    });

    if (!items.length) {
      list.innerHTML = header + `<div class="empty-my-r">
        <div class="em-icon">📝</div>
        <div class="em-msg">${I18N.t('em.noRestaurantsYet')}</div>
        <div class="em-sub">${I18N.t('em.postToSeeHere')}</div>
      </div>`;
      return;
    }

    list.innerHTML = header + `<div class="social-grid">${items.map(r => communityGridCellHtml(r)).join('')}</div>`;
    wireCardDetail(list, items);
  },
};

/* ═══════════════════════════════════════════════
   RESTAURANT DETAIL MODAL — read-only view of a saved quán
═══════════════════════════════════════════════ */
const DetailModal = {
  _current: null,

  init() {
    document.getElementById('detailClose').addEventListener('click', () => this.close());
    document.getElementById('detailModal').addEventListener('click', e => {
      if (e.target.id === 'detailModal') this.close();
    });
    document.getElementById('detailMaps').addEventListener('click', () => {
      const r = this._current;
      if (!r || r.lat == null || r.lng == null) {
        showToast(I18N.t('toast.noLocationYet'));
        return;
      }
      window.open(gmapsUrl(r), '_blank', 'noopener');
    });
  },

  open(r) {
    this._current = r;
    const cat = CATEGORIES[r.cat] || { label: '—', color: '#888', icon: '🍽️' };
    const body = document.getElementById('detailBody');
    const escape = (s) => String(s || '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
    const imgHtml = r.image
      ? `<div class="r-img-wrap"><img src="${r.image}" alt="${escape(r.name)}"></div>`
      : '';

    const hasCoords = r.lat != null && r.lng != null;
    const isGemini = !!r._gemini;
    // Preferred display: real address text. Priority:
    //   1) r.address    — what the user typed when adding the place
    //   2) r._resolvedAddress — cached reverse-geocode from earlier open
    //   3) placeholder → reverse-geocode async (ONLY for accurate coords)
    // Gemini coords are unreliable, so we DON'T reverse-geocode them (it
    // would show a confidently-wrong street) — the "Google Maps" button
    // searches by name for the authoritative location instead.
    // Demo disclaimer — shown for AI results whose address may be off.
    const demoNote = `<div class="detail-demo-note"><em>Ứng dụng đang trong giai đoạn demo nên có thể ghi sai địa chỉ — bấm 🗺️ Google Maps để xem địa chỉ &amp; chỉ đường chính xác.</em></div>`;
    let addressHtml = '';
    if (isGemini) {
      // Show Gemini's (approximate) address like before, plus a clear
      // demo disclaimer steering the user to Google Maps for the exact one.
      if (r.address) addressHtml = `<div class="detail-address">🏠 ${escape(r.address)}</div>`;
      addressHtml += demoNote;
    } else if (r.address || r._resolvedAddress) {
      addressHtml = `<div class="detail-address">🏠 ${escape(r.address || r._resolvedAddress)}</div>`;
    } else if (hasCoords) {
      addressHtml = `<div class="detail-address" id="_detailAddrPending">🏠 <em style="opacity:.6">Đang tra địa chỉ…</em></div>`;
    }
    const knownAddress = (!isGemini && (r.address || r._resolvedAddress)) || null;
    // Coords line — small hint only for accurate (non-Gemini) sources
    // when we don't yet have a human address.
    const coordsHtml = !hasCoords
      ? `<div class="detail-coords warn">⚠️ Chưa có vị trí trên map · chỉnh sửa hoặc thêm mới để gắn vị trí</div>`
      : (knownAddress || isGemini ? '' : `<div class="detail-coords">📍 ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</div>`);

    body.innerHTML = `
      ${imgHtml}
      <div class="detail-cat-wrap">
        <span class="detail-cat" style="color:${cat.color};background:${cat.color}18">${cat.icon} ${escape(cat.label)}</span>
      </div>
      <div class="detail-name">${escape(r.name)}</div>
      <div class="detail-meta">
        <span>💰 ${escape(r.price || '—')}</span>
        <span>⭐ ${(r.rating ?? 5).toFixed(1)}</span>
        ${r.hours ? `<span>🕒 ${escape(r.hours)}</span>` : ''}
      </div>
      <div class="detail-desc">${escape(r.desc || I18N.t('detail.noDesc'))}</div>
      ${addressHtml}
      ${coordsHtml}
    `;
    // Google Maps button: enabled whenever we have a name or coords
    // (searches by name for the real listing, even if coords are off).
    const mapsBtn = document.getElementById('detailMaps');
    if (mapsBtn) {
      const canMap = !!r.name || hasCoords;
      mapsBtn.disabled = !canMap;
      mapsBtn.style.opacity = canMap ? '' : '.5';
    }
    document.getElementById('detailModal').classList.add('show');

    // Reverse-geocode ONLY for accurate coords (not Gemini's approximate
    // ones). If the user closes the modal or opens another place first,
    // drop the result silently.
    if (!knownAddress && hasCoords && !isGemini) {
      Geocoder.reverse(r.lat, r.lng).then(addr => {
        if (this._current !== r) return;
        const pending = document.getElementById('_detailAddrPending');
        if (!pending) return;
        if (addr) {
          r._resolvedAddress = addr;
          pending.innerHTML = `🏠 ${escape(addr)}`;
          pending.removeAttribute('id');
        } else {
          // No address found — remove the placeholder; coords line stays.
          pending.remove();
        }
      }).catch(() => {
        const pending = document.getElementById('_detailAddrPending');
        if (pending) pending.remove();
      });
    }
  },

  close() {
    document.getElementById('detailModal').classList.remove('show');
    this._current = null;
  },
};

/* ═══════════════════════════════════════════════
   HISTORY MODAL — profile stats: quán list + trip log
═══════════════════════════════════════════════ */
const HistoryModal = {
  _esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => (
      { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
    ));
  },

  init() {
    const tripsModal = document.getElementById('tripsModal');
    document.getElementById('tripsClose').addEventListener('click', () => this._close(tripsModal));
    tripsModal.addEventListener('click', e => { if (e.target === tripsModal) this._close(tripsModal); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (tripsModal.classList.contains('show')) this._close(tripsModal);
    });
  },

  _close(el) { el.classList.remove('show'); },

  // ── Lịch sử chuyến ăn — flat name+address bars per stop
  openTrips() {
    const trips = State.profile.tripHistory || [];
    document.getElementById('tripsCount').textContent = I18N.t('trips.count', { n: trips.length });
    const body = document.getElementById('tripsBody');
    if (trips.length === 0) {
      body.innerHTML = `
        <div class="list-empty">
          <div class="list-empty-icon">🍜</div>
          <div class="list-empty-msg">${I18N.t('trips.empty')}</div>
          <div class="list-empty-sub">${I18N.t('trips.emptySub')}</div>
        </div>`;
    } else {
      const esc = this._esc;
      body.innerHTML = trips.map(trip => {
        const d = new Date(trip.at);
        const dateLabel = this._formatDate(d);
        const stopsHtml = trip.stops.map((s, i) => `
          <div class="trip-stop-box" data-id="${s.id}">
            <div class="trip-stop-idx">${i + 1}</div>
            <div class="trip-stop-info">
              <div class="trip-stop-name">${esc(s.name)}</div>
              <div class="trip-stop-addr">${esc(s.address || (s.lat != null ? `📍 ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : I18N.t('trips.noAddress')))}</div>
            </div>
          </div>`).join('');
        return `
          <div class="trip-item">
            <div class="trip-date-row">
              <div class="trip-date">📅 ${dateLabel} · ${trip.stops.length} điểm</div>
              <button type="button" class="trip-replay-btn" data-trip-id="${trip.id}" title="${I18N.t('trips.replayTitle')}">${I18N.t('trips.replay')}</button>
            </div>
            ${stopsHtml}
          </div>`;
      }).join('');
      // Tap a stop → open its detail (works even if it's an OSM/Gemini
      // stop we no longer have full state for — we saved enough on the
      // trip itself to render the modal).
      body.querySelectorAll('.trip-stop-box').forEach(el => {
        el.addEventListener('click', () => {
          const id = parseInt(el.dataset.id);
          const stop = trips.flatMap(t => t.stops).find(s => s.id === id);
          if (stop) DetailModal.open(stop);
        });
      });
      // "Đi lại" — replay the same stops in the same order, but starting
      // from wherever the user actually is right now instead of the
      // original starting point.
      body.querySelectorAll('.trip-replay-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.tripId);
          const trip = trips.find(t => t.id === id);
          if (!trip) return;
          this._close(document.getElementById('tripsModal'));
          PlanCtrl.replayTrip(trip);
        });
      });
    }
    document.getElementById('tripsModal').classList.add('show');
  },

  _formatDate(d) {
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (sameDay) return `${I18N.t('trips.today')} ${time}`;
    if (isYesterday) return `${I18N.t('trips.yesterday')} ${time}`;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${time}`;
  },
};

/* ═══════════════════════════════════════════════
   COMMUNITY — auth, browse/search, vote
   Data comes from other real users via the PocketBase backend — every
   string rendered below goes through escapeHtml() first. Don't add a
   community field to a template without it.
═══════════════════════════════════════════════ */
const COMMUNITY_CAT_TO_PB = { restaurant: 'nha_hang', street: 'via_he', snack: 'an_vat', cafe: 'ca_phe' };
const COMMUNITY_PB_TO_CAT = { nha_hang: 'restaurant', via_he: 'street', an_vat: 'snack', ca_phe: 'cafe' };
// Getter per key (như CATEGORIES.label) — tự đổi theo I18N.lang, không cần
// sửa lại 4 chỗ đang đọc COMMUNITY_PRICE_LABEL[...] khi đổi ngôn ngữ.
const COMMUNITY_PRICE_LABEL = {
  get binh_dan() { return `💸 ${I18N.t('priceLabel.cheap')}`; },
  get tam_trung() { return `💰 ${I18N.t('priceLabel.mid')}`; },
  get sang_chanh() { return `✨ ${I18N.t('priceLabel.premium')}`; },
};
const COMMUNITY_VIS_BADGE = { private: '🔒', friends: '👥', public: '🌍' };

// Instagram-style feed post — used ONLY by the Cộng đồng browse tab
// (CommunityCtrl._renderList). Profile-type views ("Quán của tôi",
// UserQuanModal) use communityGridCellHtml() instead — see that function.
// Author avatar/edit-delete is handled elsewhere (CommunityDetailModal
// branches on ownership when a card is tapped), so this is pure display.
function communityCardHtml(r) {
  const catKey = COMMUNITY_PB_TO_CAT[r.category] || 'restaurant';
  const cat = CATEGORIES[catKey];
  const priceLabel = COMMUNITY_PRICE_LABEL[r.price_range] || '';
  const photos = Community.photoUrls(r, '640x640');
  const carousel = photos.length
    ? `<div class="post-carousel" data-id="${r.id}">
         <div class="post-carousel-track">
           ${photos.map(url => `<div class="post-photo" style="background-image:url('${escapeHtml(url)}')"></div>`).join('')}
         </div>
         ${photos.length > 1 ? `<div class="post-dots">${photos.map((_, i) => `<span class="post-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>` : ''}
       </div>`
    : `<div class="post-carousel"><div class="post-carousel-track"><div class="post-photo post-photo-empty" style="background:${cat.color}22">${cat.icon}</div></div></div>`;
  const tagsHtml = (r.tags || []).map(t => `<span class="comm-r-chip">${escapeHtml(t)}</span>`).join('');
  const hashHtml = (r.hashtags || []).map(h => `<span class="comm-r-chip hashtag">#${escapeHtml(h)}</span>`).join('');
  const visBadge = COMMUNITY_VIS_BADGE[r.visibility] || '';
  const author = r.expand && r.expand.created_by;
  const authorName = (author && author.name) || I18N.t('common.anonymous');
  const authorId = (author && author.id) || r.created_by || '';

  return `<div class="post-card comm-r-card" data-id="${r.id}">
    <div class="post-head">
      <button class="post-avatar" type="button" data-user-id="${authorId}" data-user-name="${escapeHtml(authorName)}">${authorAvatar(author)}</button>
      <div class="post-head-info">
        <button class="post-author-name" type="button" data-user-id="${authorId}" data-user-name="${escapeHtml(authorName)}">${escapeHtml(authorName)}</button>
        <div class="post-meta-line">${timeAgo(r.created)} · ${visBadge}</div>
      </div>
    </div>
    ${carousel}
    <div class="post-body">
      <div class="post-actions">
        <button class="heart-btn" data-id="${r.id}"><span class="heart-ico">♡</span></button>
        <span class="heart-count">···</span>
        <span class="post-cat-pill" style="color:${cat.color};background:${cat.color}18">${cat.icon} ${cat.label}${priceLabel ? ' · ' + priceLabel : ''}</span>
      </div>
      <div class="post-caption"><b>${escapeHtml(r.name)}</b>${r.description ? ' ' + escapeHtml(r.description) : ''}</div>
      ${(tagsHtml || hashHtml) ? `<div class="comm-r-chips">${tagsHtml}${hashHtml}</div>` : ''}
    </div>
  </div>`;
}

// Square grid cell for profile-type views ("Quán của tôi", UserQuanModal) —
// tap opens CommunityDetailModal (wireCardDetail() already matches on
// .comm-r-card[data-id], kept here so that wiring works unchanged).
function communityGridCellHtml(r) {
  const catKey = COMMUNITY_PB_TO_CAT[r.category] || 'restaurant';
  const cat = CATEGORIES[catKey];
  const thumbUrl = Community.thumbnailUrl(r, '400x400');
  return thumbUrl
    ? `<div class="grid-cell comm-r-card" data-id="${r.id}" style="background-image:url('${escapeHtml(thumbUrl)}')"></div>`
    : `<div class="grid-cell comm-r-card" data-id="${r.id}" style="background:${cat.color}22">${cat.icon}</div>`;
}

// Profile header shared by "Quán của tôi" and UserQuanModal — avatar, name,
// tagline, 3 stats (posts/stars/followers), optional follow button slot.
function communityProfileHeaderHtml({ avatar, name, tagline, postCount, starCount, followerCount, followBtn }) {
  return `<div class="social-profile-header">
    <div class="social-avatar">${avatar}</div>
    <div class="social-name">${escapeHtml(name)}</div>
    ${tagline ? `<div class="social-tagline">${tagline}</div>` : ''}
    <div class="social-stats">
      <div class="social-stat"><b>${postCount}</b><span>${I18N.t('social.posts')}</span></div>
      <div class="social-stat"><b>${starCount}</b><span>${I18N.t('social.stars')}</span></div>
      <div class="social-stat"><b>${followerCount}</b><span>${I18N.t('social.followers')}</span></div>
    </div>
    ${followBtn || ''}
  </div>`;
}

// Wires left/right swipe scroll → active-dot sync for every .post-carousel
// with more than 1 photo inside `container`. Native horizontal scroll-snap
// does the actual swipe; this just keeps the dots in sync with it.
function wireCarousels(container) {
  container.querySelectorAll('.post-carousel').forEach(carousel => {
    const track = carousel.querySelector('.post-carousel-track');
    const dots = carousel.querySelectorAll('.post-dot');
    if (!track || dots.length < 2) return;
    track.addEventListener('scroll', () => {
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    }, { passive: true });
  });
}


// Heart button (feed posts) — same underlying vote mechanism as ☆, just a
// separate wiring since the feed's icon/classes are ♡/♥ not ☆/★.
function wireHeartButtons(container) {
  container.querySelectorAll('.heart-btn[data-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      btn.disabled = true;
      const r = await Community.toggleVote(id);
      btn.disabled = false;
      if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
      _loadHeartState(id, container);
    });
    _loadHeartState(btn.dataset.id, container);
  });
}
async function _loadHeartState(restaurantId, container) {
  const [mine, count] = await Promise.all([
    Community.myVote(restaurantId),
    Community.voteCount(restaurantId),
  ]);
  const btn = container.querySelector(`.heart-btn[data-id="${restaurantId}"]`);
  if (!btn) return;
  btn.classList.toggle('voted', !!mine);
  btn.querySelector('.heart-ico').textContent = mine ? '♥' : '♡';
  const countEl = btn.parentElement.querySelector('.heart-count');
  if (countEl) countEl.textContent = count;
}

// "👤 tên tác giả" — bấm mở UserQuanModal xem hết quán người đó đã đăng.
// Matches both the old list-card author button and the feed post's
// avatar/name buttons (all three carry data-user-id the same way).
function wireAuthorButtons(container) {
  container.querySelectorAll('.comm-r-author[data-user-id], .post-avatar[data-user-id], .post-author-name[data-user-id]').forEach(btn => {
    if (!btn.dataset.userId) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      UserQuanModal.open(btn.dataset.userId, btn.dataset.userName);
    });
  });
}

// Bấm vào thân card (không phải 1 nút con) mở CommunityDetailModal — đủ ảnh
// + thông tin đầy đủ, thay vì chỉ xem được ảnh đại diện + mô tả rút gọn.
function wireCardDetail(container, items) {
  container.querySelectorAll('.comm-r-card[data-id]').forEach(cardEl => {
    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const r = items.find(x => x.id === cardEl.dataset.id);
      if (r) CommunityDetailModal.open(r);
    });
  });
}

// "Theo dõi" = kết bạn, 1 chiều kiểu Twitter — bấm là xong ngay, không cần
// đối phương đồng ý (xem UserQuanModal/CommunityAddModal cho cách "bạn bè"
// dùng để lọc quán visibility="friends").
function followBtnHtml(userId, userName, following) {
  return `<button type="button" class="follow-btn${following ? ' following' : ''}" data-user-id="${userId}" data-user-name="${escapeHtml(userName)}">${following ? I18N.t('follow.following') : I18N.t('follow.notFollowing')}</button>`;
}
function wireFollowButtons(container, onChange) {
  container.querySelectorAll('.follow-btn[data-user-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.userId;
      const isFollowing = btn.classList.contains('following');
      btn.disabled = true;
      const r = isFollowing ? await Community.removeFriend(id) : await Community.addFriend(id);
      btn.disabled = false;
      if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
      btn.classList.toggle('following', !isFollowing);
      btn.textContent = !isFollowing ? I18N.t('follow.following') : I18N.t('follow.notFollowing');
      showToast(!isFollowing ? I18N.t('toast.nowFollowing') : I18N.t('toast.unfollowed'));
      if (onChange) onChange();
    });
  });
}
// "Xem profile" — tên người khác (kết quả tìm bạn, danh sách đang theo dõi,
// tác giả 1 quán) đều mở UserQuanModal: quán họ đăng mà mình xem được, kèm
// nút Theo dõi ngay trong đó.
function wireProfileLinks(container) {
  container.querySelectorAll('[data-user-id]').forEach(el => {
    if (el.classList.contains('follow-btn')) return; // nút Theo dõi xử lý riêng
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      UserQuanModal.open(el.dataset.userId, el.dataset.userName);
    });
  });
}

const CommunityCtrl = {
  _mode: 'login', // 'login' | 'register'
  _searchDebounce: null,

  init() {
    document.getElementById('communityAuthToggle').addEventListener('click', () => {
      this._mode = this._mode === 'login' ? 'register' : 'login';
      this._renderAuthMode();
    });
    document.getElementById('communityAuthSubmit').addEventListener('click', () => this._submitAuth());

    // Hiện/ẩn mật khẩu — cùng pattern với ô key Gemini ở tab Cá nhân
    const authPassword = document.getElementById('cAuthPassword');
    document.getElementById('cAuthPasswordToggle').addEventListener('click', () => {
      authPassword.type = authPassword.type === 'password' ? 'text' : 'password';
    });
    // Enter ở bất kỳ ô nào trong form đều submit — giống hành vi form thường thấy
    ['cAuthName', 'cAuthEmail', 'cAuthPassword'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this._submitAuth(); }
      });
    });

    document.getElementById('communityAddBtn').addEventListener('click', () => CommunityAddModal.open());

    const search = document.getElementById('communitySearchInput');
    search.addEventListener('input', () => {
      clearTimeout(this._searchDebounce);
      this._searchDebounce = setTimeout(() => this._loadList(search.value.trim()), 350);
    });

    this._initFriendSearch();
    this._renderAuthMode();
  },

  // Không còn UI đổi địa chỉ server trong app nữa (ẩn khỏi người dùng
  // thường) — cần đổi thì gõ thẳng `Community.BASE_URL = '...'` trong
  // console devtools, setter đã có sẵn lưu vào localStorage.

  // ── Friends ("quán đăng chế độ Bạn bè chỉ hiện với người ở đây") ─────────
  _initFriendSearch() {
    const input = document.getElementById('friendSearchInput');
    const results = document.getElementById('friendSearchResults');
    if (!input || !results) return;
    DropdownPosition.register(input, results);
    const reposition = () => DropdownPosition.reposition(input, results);

    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (q.length < 2) { results.classList.remove('show'); results.innerHTML = ''; return; }
      debounce = setTimeout(async () => {
        const [searchRes, friendsRes] = await Promise.all([Community.searchUsers(q), Community.myFriends()]);
        const items = (searchRes.ok ? searchRes.data.items : []).filter(u => u.id !== Community.currentUser?.id);
        const followingIds = new Set(((friendsRes.ok && friendsRes.data.friends) || []));
        if (!items.length) {
          results.innerHTML = `<div class="go-empty">${I18N.t('em.noUserMatch', { q: escapeHtml(q) })}</div>`;
        } else {
          // Tên → xem profile (UserQuanModal); nút riêng → theo dõi/bỏ theo
          // dõi. Không đóng dropdown sau khi bấm — theo dõi nhiều người
          // trong 1 lần tìm cho tự nhiên, giống mạng xã hội thật.
          results.innerHTML = items.map(u => `
            <div class="go-item follow-row">
              <span class="follow-name" data-user-id="${u.id}" data-user-name="${escapeHtml(u.name || I18N.t('common.anonymous'))}">👤 ${escapeHtml(u.name || I18N.t('common.anonymous'))}</span>
              ${followBtnHtml(u.id, u.name || I18N.t('common.anonymous'), followingIds.has(u.id))}
            </div>`).join('');
          wireProfileLinks(results);
          wireFollowButtons(results, () => this._renderFriends());
        }
        reposition();
        results.classList.add('show');
      }, 350);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#friendSearchInput') && !e.target.closest('#friendSearchResults')) {
        results.classList.remove('show');
      }
    });
  },

  async _renderFriends() {
    const el = document.getElementById('friendList');
    if (!el) return;
    const r = await Community.myFriends();
    const friends = (r.ok && r.data.expand && r.data.expand.friends) || [];
    if (!friends.length) {
      el.innerHTML = `<span style="font-size:.78rem;color:var(--text3)">${I18N.t('em.noFriendsYet')}</span>`;
      return;
    }
    el.innerHTML = friends.map(u => `<span class="chip-tag"><span data-user-id="${u.id}" data-user-name="${escapeHtml(u.name || I18N.t('common.anonymous'))}" style="cursor:pointer">👤 ${escapeHtml(u.name || I18N.t('common.anonymous'))}</span><button type="button" class="chip-tag-remove" data-id="${u.id}">✕</button></span>`).join('');
    wireProfileLinks(el);
    el.querySelectorAll('.chip-tag-remove').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const r2 = await Community.removeFriend(b.dataset.id);
        if (!r2.ok) { showToast(`⚠️ ${r2.error}`); return; }
        this._renderFriends();
      });
    });
  },

  _renderAuthMode() {
    const isRegister = this._mode === 'register';
    document.getElementById('communityNameGroup').classList.toggle('hidden', !isRegister);
    document.getElementById('communityAuthSubmit').textContent = isRegister ? I18N.t('community.register') : I18N.t('community.signIn');
    document.getElementById('communityAuthToggle').textContent = isRegister
      ? I18N.t('community.toLogin') : I18N.t('community.toRegister');
  },

  async _submitAuth() {
    const email = document.getElementById('cAuthEmail').value.trim();
    const password = document.getElementById('cAuthPassword').value;
    const name = document.getElementById('cAuthName').value.trim();
    if (!email || !password) { showToast(I18N.t('toast.fillEmailPassword')); return; }
    if (this._mode === 'register' && password.length < 8) { showToast(I18N.t('toast.passwordMin8')); return; }

    const btn = document.getElementById('communityAuthSubmit');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = I18N.t('auth.processing');
    const r = this._mode === 'register'
      ? await Community.register(email, password, name)
      : await Community.login(email, password);
    btn.disabled = false; btn.textContent = original;

    if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
    showToast(this._mode === 'register' ? I18N.t('toast.registered') : I18N.t('toast.loginSuccess'));
    document.getElementById('cAuthPassword').value = '';
    // One-time backfill: this account's avatar_emoji field didn't exist
    // until this session's redesign, so anyone who already picked an
    // emoji locally (or just registered, which never sets one) needs it
    // pushed up once so their posts show the right avatar to others.
    if (!r.data.avatar_emoji) Community.updateAvatar(State.profile.avatar);
    this.render();
  },

  render() {
    const loggedIn = Community.isLoggedIn();
    document.getElementById('communityAuth').classList.toggle('hidden', loggedIn);
    document.getElementById('communityMain').classList.toggle('hidden', !loggedIn);
    if (!loggedIn) return;
    this._loadList('');
  },

  async _loadList(query) {
    const list = document.getElementById('communityList');
    list.innerHTML = `<div class="empty-comm"><div class="em-icon">⏳</div><div class="em-msg">${I18N.t('em.loading')}</div></div>`;
    const r = query ? await Community.searchRestaurants(query) : await Community.listRestaurants();
    if (!r.ok) {
      list.innerHTML = `<div class="empty-comm">
        <div class="em-icon">😕</div><div class="em-msg">${I18N.t('em.loadFail')}</div>
        <div class="em-sub">${escapeHtml(r.error)}</div>
      </div>`;
      return;
    }
    this._renderList(r.data.items, query);
  },

  // query khác rỗng khi đang tìm kiếm — 0 kết quả lúc đó nghĩa là "không
  // khớp", không phải "cộng đồng chưa có quán nào" (2 tình huống khác hẳn
  // nhau, gộp chung dễ hiểu lầm là cả cộng đồng trống trơn).
  _renderList(items, query) {
    const list = document.getElementById('communityList');
    if (!items.length) {
      list.innerHTML = query
        ? `<div class="empty-comm">
            <div class="em-icon">🔍</div>
            <div class="em-msg">${I18N.t('em.noMatchFor', { q: escapeHtml(query) })}</div>
            <div class="em-sub">${I18N.t('em.tryShorterQuery')}</div>
          </div>`
        : `<div class="empty-comm">
            <div class="em-icon">🍽️</div>
            <div class="em-msg">${I18N.t('em.communityEmpty')}</div>
            <div class="em-sub">${I18N.t('em.postFirst')}</div>
          </div>`;
      return;
    }
    list.innerHTML = items.map(r => communityCardHtml(r)).join('');
    wireHeartButtons(list);
    wireAuthorButtons(list);
    wireCarousels(list);
    wireCardDetail(list, items);
  },
};

/* ═══════════════════════════════════════════════
   COMMUNITY DETAIL MODAL — full photos + info for 1 quán cộng đồng
   Separate from DetailModal (r.cat/r.lat/r.lng, local-only records) since
   community records have a different shape (r.category is a PB select
   value, r.location is {lat,lon}, plus tags/hashtags/visibility/photos).
═══════════════════════════════════════════════ */
const CommunityDetailModal = {
  _current: null,

  init() {
    document.getElementById('communityDetailClose').addEventListener('click', () => this.close());
    document.getElementById('communityDetailModal').addEventListener('click', (e) => {
      if (e.target.id === 'communityDetailModal') this.close();
    });
    document.getElementById('communityDetailMaps').addEventListener('click', () => {
      const r = this._current;
      const hasLoc = r && r.location && (r.location.lat !== 0 || r.location.lon !== 0);
      if (!hasLoc) { showToast(I18N.t('toast.noLocationYet')); return; }
      window.open(gmapsUrl({ name: r.name, address: r.address, lat: r.location.lat, lng: r.location.lon }), '_blank', 'noopener');
    });
  },

  open(r) {
    this._current = r;
    const catKey = COMMUNITY_PB_TO_CAT[r.category] || 'restaurant';
    const cat = CATEGORIES[catKey];
    const priceLabel = COMMUNITY_PRICE_LABEL[r.price_range] || '';
    const visBadge = COMMUNITY_VIS_BADGE[r.visibility] || '';
    const photos = Community.photoUrls(r, '800x800');
    const carousel = photos.length
      ? `<div class="post-carousel" style="border-radius:var(--radius);overflow:hidden;margin-bottom:.7rem">
           <div class="post-carousel-track">${photos.map(url => `<div class="post-photo" style="background-image:url('${escapeHtml(url)}')"></div>`).join('')}</div>
           ${photos.length > 1 ? `<div class="post-dots">${photos.map((_, i) => `<span class="post-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>` : ''}
         </div>`
      : '';
    const tagsHtml = (r.tags || []).map(t => `<span class="comm-r-chip">${escapeHtml(t)}</span>`).join('');
    const hashHtml = (r.hashtags || []).map(h => `<span class="comm-r-chip hashtag">#${escapeHtml(h)}</span>`).join('');
    const author = r.expand && r.expand.created_by;
    const authorName = (author && author.name) || I18N.t('common.anonymous');
    const authorId = (author && author.id) || r.created_by || '';
    const addressHtml = r.address ? `<div class="detail-address">🏠 ${escapeHtml(r.address)}</div>` : '';
    const isOwner = !!(Community.currentUser && (r.created_by === Community.currentUser.id || authorId === Community.currentUser.id));

    const footerHtml = isOwner
      ? `<button class="data-btn" id="cdmEdit">✏️ Sửa</button>
         <button class="my-r-del" id="cdmDelete" title="${I18N.t('myR.delete')}">🗑</button>`
      : `<button class="post-avatar" type="button" data-user-id="${authorId}" data-user-name="${escapeHtml(authorName)}" style="width:30px;height:30px;font-size:1rem">${authorAvatar(author)}</button>
         <button class="comm-r-author" type="button" data-user-id="${authorId}" data-user-name="${escapeHtml(authorName)}">${escapeHtml(authorName)}</button>
         <div style="margin-left:auto;display:flex;align-items:center;gap:.35rem">
           <button class="heart-btn" data-id="${r.id}"><span class="heart-ico">♡</span></button>
           <span class="heart-count">···</span>
         </div>`;

    document.getElementById('communityDetailBody').innerHTML = `
      ${carousel}
      <div class="detail-cat-wrap">
        <span class="detail-cat" style="color:${cat.color};background:${cat.color}18">${cat.icon} ${cat.label}</span>
        ${priceLabel ? `<span class="detail-cat" style="color:var(--text2);background:var(--cream-2)">${priceLabel}</span>` : ''}
        <span class="detail-cat" style="color:var(--text2);background:var(--cream-2)">${visBadge}</span>
      </div>
      <div class="detail-name">${escapeHtml(r.name)}</div>
      ${r.description ? `<div class="detail-desc">${escapeHtml(r.description)}</div>` : ''}
      ${(tagsHtml || hashHtml) ? `<div class="comm-r-chips" style="margin-bottom:.6rem">${tagsHtml}${hashHtml}</div>` : ''}
      ${addressHtml}
      <div class="comm-r-footer" style="border-top:1.5px dashed var(--line-2);margin-top:.9rem;padding-top:.7rem">
        ${footerHtml}
      </div>
    `;
    const body = document.getElementById('communityDetailBody');
    wireCarousels(body);
    if (isOwner) {
      document.getElementById('cdmEdit').addEventListener('click', () => { this.close(); CommunityAddModal.open(r); });
      document.getElementById('cdmDelete').addEventListener('click', async () => {
        if (!confirm(I18N.t('myR.confirmDelete', { name: r.name }))) return;
        const res = await Community.deleteRestaurant(r.id);
        if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
        showToast(I18N.t('toast.restaurantDeleted'));
        this.close();
        ProfileCtrl._loadMyRestaurants();
      });
    } else {
      wireHeartButtons(body);
      wireAuthorButtons(body);
    }

    const hasLoc = r.location && (r.location.lat !== 0 || r.location.lon !== 0);
    const mapsBtn = document.getElementById('communityDetailMaps');
    mapsBtn.disabled = !hasLoc;
    mapsBtn.style.opacity = hasLoc ? '' : '.5';

    document.getElementById('communityDetailModal').classList.add('show');
  },

  close() {
    document.getElementById('communityDetailModal').classList.remove('show');
  },
};

/* ═══════════════════════════════════════════════
   USER QUÁN MODAL — every quán 1 người đã đăng mà tôi xem được (rule
   visibility phía server tự lọc: public/friends-nếu-tôi-là-bạn/chính tôi)
═══════════════════════════════════════════════ */
const UserQuanModal = {
  init() {
    document.getElementById('userQuanClose').addEventListener('click', () => this.close());
    document.getElementById('userQuanModal').addEventListener('click', (e) => {
      if (e.target.id === 'userQuanModal') this.close();
    });
  },

  async open(userId, userName) {
    document.getElementById('userQuanTitle').innerHTML = I18N.t('userQuan.title', { name: escapeHtml(userName || I18N.t('common.thisPerson')) });
    const body = document.getElementById('userQuanBody');
    body.innerHTML = `<div class="empty-comm"><div class="em-icon">⏳</div><div class="em-msg">${I18N.t('em.loading')}</div></div>`;
    document.getElementById('userQuanCount').textContent = '';
    document.getElementById('userQuanModal').classList.add('show');

    // Nút Theo dõi ngay trong profile — không hiện với chính mình.
    const followSlot = document.getElementById('userQuanFollowSlot');
    followSlot.innerHTML = '';
    const isSelf = Community.currentUser && userId === Community.currentUser.id;
    if (Community.currentUser && !isSelf) {
      const friendsRes = await Community.myFriends();
      const following = !!(friendsRes.ok && (friendsRes.data.friends || []).includes(userId));
      followSlot.innerHTML = followBtnHtml(userId, userName || I18N.t('common.thisPerson'), following);
      wireFollowButtons(followSlot, () => CommunityCtrl._renderFriends());
    }

    const [userRes, listRes, followerCount] = await Promise.all([
      Community.getUser(userId),
      Community.listRestaurants({ filter: `created_by="${userId}"` }),
      Community.followerCount(userId),
    ]);
    if (!listRes.ok) {
      body.innerHTML = `<div class="empty-comm"><div class="em-icon">😕</div><div class="em-msg">${I18N.t('em.loadFail')}</div></div>`;
      return;
    }
    const items = listRes.data.items;
    const avatar = authorAvatar(userRes.ok ? userRes.data : null);
    const displayName = (userRes.ok && userRes.data.name) || userName || I18N.t('common.thisPerson');
    const starCounts = await Promise.all(items.map(x => Community.voteCount(x.id)));
    const starTotal = starCounts.reduce((a, b) => a + b, 0);

    const header = communityProfileHeaderHtml({
      avatar, name: displayName, tagline: '',
      postCount: items.length, starCount: starTotal, followerCount,
    });

    if (!items.length) {
      body.innerHTML = header + `<div class="empty-comm"><div class="em-icon">🍽️</div><div class="em-msg">${I18N.t('em.noneVisible')}</div></div>`;
      return;
    }
    body.innerHTML = header + `<div class="social-grid">${items.map(x => communityGridCellHtml(x)).join('')}</div>`;
    wireCardDetail(body, items);
  },

  close() {
    document.getElementById('userQuanModal').classList.remove('show');
  },
};

/* ═══════════════════════════════════════════════
   COMMUNITY ADD RESTAURANT MODAL
═══════════════════════════════════════════════ */
const CommunityAddModal = {
  _selectedCat: 'restaurant',
  _selectedPrice: 'binh_dan',
  _selectedVisibility: 'public',
  _pickedLat: null,
  _pickedLng: null,
  _tags: [],
  _hashtags: [],
  _photoFiles: [],
  _photoPreviewUrls: [],
  _thumbIndex: 0,
  _editingId: null,      // null = đăng quán mới; có giá trị = đang sửa quán này
  _editingRecord: null,
  _existingPhotos: [],   // URL ảnh đã có sẵn trên server, khi đang sửa

  init() {
    document.getElementById('cfCatPicker').addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-pick-btn');
      if (!btn) return;
      document.querySelectorAll('#cfCatPicker .cat-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._selectedCat = btn.dataset.cat;
    });

    document.getElementById('cfPricePicker').addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-pick-btn');
      if (!btn) return;
      document.querySelectorAll('#cfPricePicker .cat-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._selectedPrice = btn.dataset.price;
    });

    document.getElementById('cfVisibilityPicker').addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-pick-btn');
      if (!btn) return;
      document.querySelectorAll('#cfVisibilityPicker .cat-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._selectedVisibility = btn.dataset.vis;
    });

    document.getElementById('cfCancel').addEventListener('click', () => this.close());
    document.getElementById('communityAddModal').addEventListener('click', (e) => {
      if (e.target.id === 'communityAddModal') this.close();
    });

    document.getElementById('cfPhotoInput').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      const room = 4 - this._photoFiles.length;
      if (files.length > room) showToast(I18N.t('toast.tooManyPhotos', { room }));
      files.slice(0, room).forEach(f => {
        this._photoFiles.push(f);
        this._photoPreviewUrls.push(URL.createObjectURL(f));
      });
      e.target.value = '';
      this._renderPhotoGrid();
    });

    // Tag/hashtag arrays are mutated in place (never reassigned) so these
    // closures keep working after open() resets the form.
    this._wireChipInput('cfTagInput', 'cfTagList', this._tags, { hashtag: false });
    this._wireChipInput('cfHashtagInput', 'cfHashtagList', this._hashtags, { hashtag: true });

    document.getElementById('cfSave').addEventListener('click', () => this._save());

    LocationPicker.initSearch('cfLocSearch', 'cfLocSuggest', (r) => {
      this._pickedLat = r.lat;
      this._pickedLng = r.lng;
      if (State.communityPickerMap) {
        State.communityPickerMap.setView([r.lat, r.lng], 17);
        LocationPicker.setMarker('communityPickerMap', 'communityPickerMarker', r.lat, r.lng, this._selectedCat);
      }
      document.getElementById('cfLocSearch').value = r.name;
      Geocoder.hide(document.getElementById('cfLocSuggest'));
    });
  },

  _wireChipInput(inputId, listId, arr, { hashtag }) {
    const input = document.getElementById(inputId);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const raw = input.value.trim();
      if (!raw) return;
      const val = hashtag ? Community.normalizeHashtags([raw])[0] : raw.slice(0, 30);
      input.value = '';
      if (!val || arr.some(x => x.toLowerCase() === val.toLowerCase())) return;
      const max = hashtag ? 15 : 10;
      if (arr.length >= max) { showToast(I18N.t('toast.maxTagsOrHashtags', { max, kind: I18N.t(hashtag ? 'kind.hashtag' : 'kind.tag') })); return; }
      arr.push(val);
      this._renderChipList(listId, arr, hashtag);
    });
  },

  _renderChipList(listId, arr, hashtag) {
    const el = document.getElementById(listId);
    el.innerHTML = arr.map((v, i) => `<span class="chip-tag${hashtag ? ' hashtag' : ''}">${hashtag ? '#' : ''}${escapeHtml(v)}<button type="button" class="chip-tag-remove" data-i="${i}">✕</button></span>`).join('');
    el.querySelectorAll('.chip-tag-remove').forEach(b => {
      b.addEventListener('click', () => {
        arr.splice(parseInt(b.dataset.i), 1);
        this._renderChipList(listId, arr, hashtag);
      });
    });
  },

  _renderPhotoGrid() {
    const grid = document.getElementById('cfPhotoGrid');

    // Chế độ sửa: chỉ xem ảnh có sẵn + đổi thumbnail, không thêm/xoá ảnh ở
    // đây (giữ đơn giản — đổi ảnh đầy đủ thì đăng quán mới).
    if (this._editingId) {
      if (!this._existingPhotos.length) {
        grid.innerHTML = `<div style="grid-column:span 4;font-size:.78rem;color:var(--text3)">${I18N.t('photo.none')}</div>`;
        return;
      }
      const filenames = this._editingRecord.photos || [];
      grid.innerHTML = this._existingPhotos.map((url, i) => {
        const filename = filenames[i];
        const starActive = filename && filename === this._editingRecord.thumbnail ? ' active' : '';
        return `<div class="photo-slot" style="background-image:url('${url}')">
          <button type="button" class="photo-thumb-star${starActive}" data-filename="${filename}" title="${I18N.t('photo.setCover')}">⭐</button>
        </div>`;
      }).join('');
      grid.querySelectorAll('.photo-thumb-star').forEach(b => {
        b.addEventListener('click', async (e) => {
          e.stopPropagation();
          const r = await Community.setThumbnail(this._editingId, b.dataset.filename);
          if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
          this._editingRecord = r.data;
          this._renderPhotoGrid();
          showToast(I18N.t('toast.thumbnailChanged'));
        });
      });
      return;
    }

    const slots = this._photoFiles.map((file, i) => {
      const url = this._photoPreviewUrls[i];
      const starActive = i === this._thumbIndex ? ' active' : '';
      return `<div class="photo-slot" style="background-image:url('${url}')">
        <button type="button" class="photo-slot-remove" data-idx="${i}">✕</button>
        <button type="button" class="photo-thumb-star${starActive}" data-idx="${i}" title="${I18N.t('photo.setCover')}">⭐</button>
      </div>`;
    }).join('');
    const addSlot = this._photoFiles.length < 4
      ? `<button class="photo-slot photo-slot-empty" id="cfPhotoAddBtn" type="button">＋<br><span style="font-size:.65rem">Thêm ảnh</span></button>`
      : '';
    grid.innerHTML = slots + addSlot;

    const addBtn = document.getElementById('cfPhotoAddBtn');
    if (addBtn) addBtn.addEventListener('click', () => document.getElementById('cfPhotoInput').click());
    grid.querySelectorAll('.photo-slot-remove').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(b.dataset.idx);
        URL.revokeObjectURL(this._photoPreviewUrls[idx]);
        this._photoFiles.splice(idx, 1);
        this._photoPreviewUrls.splice(idx, 1);
        if (this._thumbIndex === idx) this._thumbIndex = 0;
        else if (this._thumbIndex > idx) this._thumbIndex--;
        this._renderPhotoGrid();
      });
    });
    grid.querySelectorAll('.photo-thumb-star').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this._thumbIndex = parseInt(b.dataset.idx);
        this._renderPhotoGrid();
      });
    });
  },

  // record: truyền vào khi sửa quán có sẵn (từ tab Cá nhân); bỏ trống = đăng mới.
  open(record = null) {
    if (!Community.isLoggedIn()) { showToast(I18N.t('toast.needLoginBang')); return; }
    const modal = document.getElementById('communityAddModal');
    modal.classList.add('show');

    this._editingId = record ? record.id : null;
    this._editingRecord = record;
    document.querySelector('#communityAddModal .modal-title').innerHTML = record
      ? I18N.t('addQuan.editTitle') : I18N.t('addQuan.title');
    document.getElementById('cfSave').textContent = record ? I18N.t('addQuan.update') : I18N.t('addQuan.submit');

    document.getElementById('cfName').value = record ? record.name : '';
    document.getElementById('cfDesc').value = record ? (record.description || '') : '';
    const loc = document.getElementById('cfLocSearch');
    if (loc) loc.value = record ? (record.address || '') : '';
    const locSug = document.getElementById('cfLocSuggest');
    if (locSug) Geocoder.hide(locSug);

    this._selectedCat = record ? (COMMUNITY_PB_TO_CAT[record.category] || 'restaurant') : 'restaurant';
    this._selectedPrice = record ? (record.price_range || 'binh_dan') : 'binh_dan';
    this._selectedVisibility = record ? (record.visibility || 'public') : 'public';
    document.querySelectorAll('#cfCatPicker .cat-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === this._selectedCat));
    document.querySelectorAll('#cfPricePicker .cat-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.price === this._selectedPrice));
    document.querySelectorAll('#cfVisibilityPicker .cat-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.vis === this._selectedVisibility));

    // {lon:0,lat:0} là giá trị mặc định của geoPoint chưa từng set — coi như
    // chưa có vị trí, không phải thật sự ở toạ độ 0,0.
    const hasLoc = record && record.location && (record.location.lat !== 0 || record.location.lon !== 0);
    this._pickedLat = hasLoc ? record.location.lat : null;
    this._pickedLng = hasLoc ? record.location.lon : null;

    this._tags.length = 0;
    this._hashtags.length = 0;
    if (record) {
      (record.tags || []).forEach(t => this._tags.push(t));
      (record.hashtags || []).forEach(h => this._hashtags.push(h));
    }
    this._renderChipList('cfTagList', this._tags, false);
    this._renderChipList('cfHashtagList', this._hashtags, true);

    this._photoPreviewUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch(_) {} });
    this._photoFiles.length = 0;
    this._photoPreviewUrls.length = 0;
    this._thumbIndex = 0;
    this._existingPhotos = record ? (record.photos || []).map(f => Community.photoUrl(record, f, '200x200')) : [];
    this._renderPhotoGrid();

    const center = hasLoc
      ? [record.location.lat, record.location.lon]
      : [State.userLat || 21.0285, State.userLng || 105.8542];
    setTimeout(() => {
      LocationPicker.initMap('communityPickerMap', 'communityPickerMap', 'communityPickerMarker', center, (lat, lng) => {
        this._pickedLat = lat;
        this._pickedLng = lng;
        LocationPicker.setMarker('communityPickerMap', 'communityPickerMarker', lat, lng, this._selectedCat);
      });
      if (hasLoc) LocationPicker.setMarker('communityPickerMap', 'communityPickerMarker', record.location.lat, record.location.lon, this._selectedCat);
    }, 250);
  },

  close() {
    document.getElementById('communityAddModal').classList.remove('show');
    this._editingId = null;
    this._editingRecord = null;
    setTimeout(() => LocationPicker.teardownMap('communityPickerMap'), 300);
  },

  async _save() {
    const name = document.getElementById('cfName').value.trim();
    if (!name) { showToast(I18N.t('toast.needNameFirst')); return; }
    if (!Community.isLoggedIn()) { showToast(I18N.t('toast.needLoginBang')); return; }

    const desc = document.getElementById('cfDesc').value.trim();
    const addressText = (document.getElementById('cfLocSearch')?.value || '').trim();
    let lat = this._pickedLat, lng = this._pickedLng;

    const btn = document.getElementById('cfSave');
    const original = btn.textContent;

    if (lat == null && addressText.length >= 3) {
      btn.disabled = true; btn.textContent = I18N.t('addQuan.lookingUpLoc');
      const found = await LocationPicker.geocodeFallback(addressText);
      if (found) { lat = found.lat; lng = found.lng; }
    }

    // Sửa quán có sẵn — PATCH field text/chọn, không đụng ảnh (xem _renderPhotoGrid)
    if (this._editingId) {
      btn.disabled = true; btn.textContent = I18N.t('addQuan.saving');
      const r = await Community.updateRestaurant(this._editingId, {
        name,
        category: COMMUNITY_CAT_TO_PB[this._selectedCat],
        priceRange: this._selectedPrice,
        visibility: this._selectedVisibility,
        description: desc,
        address: addressText,
        lat, lng,
        tags: this._tags,
        hashtags: this._hashtags,
      });
      btn.disabled = false; btn.textContent = original;
      if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
      showToast(I18N.t('toast.updatedName', { name }));
      this.close();
      ProfileCtrl._loadMyRestaurants();
      return;
    }

    btn.disabled = true; btn.textContent = I18N.t('addQuan.posting');

    // Move the chosen cover photo to index 0 — createRestaurant() auto-sets
    // thumbnail = photos[0] right after the record is created.
    const orderedFiles = this._thumbIndex > 0 && this._photoFiles[this._thumbIndex]
      ? [this._photoFiles[this._thumbIndex], ...this._photoFiles.filter((_, i) => i !== this._thumbIndex)]
      : this._photoFiles;

    const r = await Community.createRestaurant({
      name,
      category: COMMUNITY_CAT_TO_PB[this._selectedCat],
      priceRange: this._selectedPrice,
      visibility: this._selectedVisibility,
      description: desc,
      address: addressText,
      lat, lng,
      tags: this._tags,
      hashtags: this._hashtags,
      photoFiles: orderedFiles,
    });

    btn.disabled = false; btn.textContent = original;

    if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
    showToast(I18N.t('toast.postedName', { name }));
    this.close();
    CommunityCtrl._loadList('');
  },
};
