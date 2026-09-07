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
        if (State.activeCats.size === 1) { showToast('Chọn ít nhất 1 loại nhé!'); return; }
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
        showToast('👥 Sắp có · cần backend cho ratings cộng đồng');
        return;
      }
      if (State.activeSrcs.has(src)) {
        if (State.activeSrcs.size === 1) { showToast('Chọn ít nhất 1 nguồn nhé!'); return; }
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

    this._updateBadge();
  },

  // Debounced address suggestions dropdown for the "Điểm xuất phát" field.
  // Selecting a suggestion re-centers the map so the user can see exactly
  // where the scan will happen before pressing Quét.
  _initLocInput() {
    const input = document.getElementById('locInput');
    const suggest = document.getElementById('locSuggest');
    if (!input || !suggest) return;

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
      Geocoder.showLoading(suggest);
      Geocoder.onInput('locInput', q, 450, (results) => {
        Geocoder.renderSuggestions(suggest, results, pick);
      }, bias());
    });

    // Enter picks the first suggestion, or triggers a scan if nothing typed
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = input.value.trim();
      if (!q) { this.scan(); return; }
      Geocoder.showLoading(suggest);
      const results = await Geocoder.search(q, bias());
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
    badge.textContent = total > 0 ? `✦ ${total} quán` : '✦ Quét để tìm';
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
      showToast('📍 Gõ địa chỉ hoặc bật GPS trước nhé!');
      return;
    }
    if (isDefault || !State.userLat) {
      if (typedQ.length >= 3) {
        showToast('🔍 Đang tìm vị trí…', 1500);
        const results = await Geocoder.search(typedQ.replace(/^📌\s*/, ''), { nearLat: State.userLat, nearLng: State.userLng });
        if (results.length) {
          MapHome.setUserLocation(results[0].lat, results[0].lng, null, { center: true });
          if (locInput) locInput.value = results[0].name;
          Geocoder.hide(document.getElementById('locSuggest'));
        }
      }
      if (!State.userLat || isDefault) {
        showToast('📍 Dùng GPS hoặc nhập địa chỉ (nhấn Enter) trước nhé!');
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
      showToast('⚡ Từ cache · bấm 🔀 để quét lại', 1800);
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
      const statusMsgs = useGemini
        ? ['✨ Gemini + 🗺️ OSM đang tìm song song…', '🔍 Đang tìm quán gần bạn…', '✨ Hỏi Gemini AI…', '🗺️ Quét bản đồ…', '⏳ Sắp có kết quả rồi…']
        : ['🗺️ OSM đang quét quanh bạn…', '🔍 Đang tìm quán…', '⏳ Sắp xong rồi…'];
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
        setSubTxt(`⏱ ${s}s · tối đa 20s`);
      }, 1000);
      setSubTxt('⏱ 0s · tối đa 20s');

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
        // ── DISH SEARCH: only Gemini understands a specific dish. OSM
        //    returns generic nearby quán and would win the race with
        //    useless results, so we WAIT for Gemini and only fall back
        //    to OSM if Gemini comes back empty. ─────────────────────────
        const g = await geminiP;
        if (g.length) {
          raceResult = { items: g, source: 'gemini' };
        } else {
          const o = await osmP;
          raceResult = { items: o, source: o.length ? 'osm' : 'none' };
        }
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
    ov.style.display = 'none';
    this._scanning = false;

    // ── Toast kết quả ───────────────────────────────────────────────────
    if (items.length) {
      const srcLabel = source === 'gemini' ? '✨ Gemini' : '🗺️ OSM';
      showToast(`✅ Tìm thấy ${items.length} quán (${srcLabel})`, 2200);
    } else if (State.activeSrcs.has('osm')) {
      // Nothing came back from either source
      const geminiOn = typeof Gemini !== 'undefined' && Gemini.isConfigured();
      if (!geminiOn) {
        showToast('🔑 Chưa có Gemini key · vào Cá nhân thêm key để tìm quán thông minh', 4000);
      } else {
        showToast('😕 Không tìm thấy quán · thử tăng bán kính hoặc đổi vị trí', 3500);
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
      showToast('🍽️ Đã xoá bộ lọc món');
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
        showToast(`🔍 Không tìm thấy "${State.activeDish}" cụ thể · hiện ${fallback.length} quán gần đây`, 3000);
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
      let hint = 'Thử tăng bán kính hoặc bật GPS ở vị trí khác';
      if (!State.activeSrcs.has('osm')) hint = 'Bật 🌐 OpenStreetMap để tìm quán';
      showToast(`🤔 Không tìm thấy quán · ${hint}`);
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
    document.getElementById('resultsTitle').textContent = `${n} quán gần đây`;
    const src = State.lastScanSource === 'gemini' ? '✨ Google Maps (Gemini)'
      : State.lastScanSource === 'osm' ? '🌐 OpenStreetMap'
      : '📌 Chưa quét';
    document.getElementById('resultsSub').textContent = `${fmtDist(State.radius)} · ${src}`;
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
          <div class="es-msg">Chưa tìm thấy "<b>${esc}</b>" trong dữ liệu app<br>
            <span style="font-size:.82rem;opacity:.75">Bấm nút dưới để tìm trực tiếp trên Google Maps</span>
          </div>
          <a class="es-gmaps-btn" href="${gmapsSearchUrl(q)}" target="_blank" rel="noopener">🗺️ Tìm "${esc}" trên Google Maps</a>
        </div>`;
      } else {
        grid.innerHTML = `<div class="empty-state"><div class="es-icon">🍽️</div><div class="es-msg">Không có quán loại này<br>trong bán kính tìm kiếm</div></div>`;
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
      bannerHtml = `<a class="es-gmaps-banner" href="${gmapsSearchUrl(q)}" target="_blank" rel="noopener">
        🗺️ Chưa đúng "<b>${esc}</b>"? Tìm chính xác trên Google Maps →
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
      const ratingLabel = isGemini ? `${r.rating.toFixed(1)} ★` : (isOsm ? '🌐 OSM' : `${r.rating} ★`);
      const hoursBadge = this._renderHoursBadge(r);
      return `<div class="r-card${sel?' selected':''}${flagCls}" data-id="${r.id}" style="animation-delay:${Math.min(i,10)*30}ms" role="button" tabindex="0" title="Nhấn để xem chi tiết">
        <button class="r-check" data-id="${r.id}" title="Chọn để thêm vào lịch trình" aria-label="Chọn" aria-pressed="${sel?'true':'false'}">✓</button>
        <div class="r-cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${cat.label}</div>
        <div class="r-name">${r.name}</div>
        ${hoursBadge}
        <div class="r-price">${priceLabel}</div>
        <div class="r-desc">${r.desc}</div>
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
    btn.textContent = n === 0 ? 'Lên lịch' : `📋 Lên lịch ${n} quán đã chọn`;
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
        showToast('🔄 Đang quét lại từ API…');
        setTimeout(() => HomeCtrl.scan(), 200);
        return;
      }
      this._lastShuffle = now;
      State.filteredResults = shuffle(State.filteredResults);
      this._applyFilters();
      showToast('🔀 Xáo lại · nhấn lại nhanh để quét mới');
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
          if (State.selected.size >= 6) { showToast('Tối đa 6 quán mỗi chuyến 😄'); return; }
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
      PlanCtrl.buildItinerary();
      PlanCtrl.show();
    });
  },
};

/* ═══════════════════════════════════════════════
   PLAN CONTROLLER
═══════════════════════════════════════════════ */
const PlanCtrl = {
  buildItinerary() {
    const all = allRestaurants();
    const stops = all
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
    document.getElementById('resultsScreen').classList.add('hidden');
    document.getElementById('planScreen').classList.remove('hidden');
    this._renderSummary();
    this._renderTimeline();
    this._initPlanMap();
  },

  _renderSummary() {
    const totalTravel = State.itinerary.reduce((s,x) => s+x.travelMin, 0);
    const totalDwell  = State.itinerary.reduce((s,x) => s+x.dwell, 0);
    const totalDist   = State.itinerary.reduce((s,x) => s+x._legDist, 0);
    const endTime     = State.itinerary.length ? State.itinerary[State.itinerary.length-1].departureClock : new Date();
    const startTime   = State.itinerary.length ? addMinutes(State.itinerary[0].arrivalClock, -State.itinerary[0].travelMin) : new Date();

    document.getElementById('planSummary').innerHTML = `
      <div class="sum-chip"><span class="sci">🏪</span>${State.itinerary.length} điểm</div>
      <div class="sum-chip"><span class="sci">🕐</span>${fmtClock(startTime)} → ${fmtClock(endTime)}</div>
      <div class="sum-chip"><span class="sci">⏱</span>${fmtTime(totalTravel+totalDwell)}</div>
      <div class="sum-chip"><span class="sci">📍</span>${fmtDist(totalDist)}</div>
      <div class="sum-chip"><span class="sci">🛵</span>Xe máy</div>
    `;
  },

  _renderHoursWarning(stop) {
    if (!stop.hours) return '';
    const parsed = parseOpeningHours(stop.hours);
    if (!parsed || parsed.isOpen !== false) return '';
    return `<div class="tl-hours-warn">⚠️ Quán có thể đã đóng lúc bạn đến · ${parsed.detail}</div>`;
  },

  _renderTimeline() {
    const tl = document.getElementById('timeline');
    let html = '';

    html += `<div class="tl-item">
      <div class="tl-spine"><div class="tl-dot" style="background:#F8DFD3;border-color:#B92626;font-size:.85rem">📍</div><div class="tl-line"></div></div>
      <div class="tl-content"><div class="tl-start">Xuất phát · ${fmtClock(addMinutes(State.itinerary[0].arrivalClock, -State.itinerary[0].travelMin))}</div></div>
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
              <div class="tl-travel-time">${stop.travelMin} phút di chuyển</div>
              <div class="tl-travel-dist">${fmtDist(stop._legDist)} · xe máy</div>
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
                <div class="tl-stop-name">${stop.name}</div>
                <div class="tl-stop-cat" style="color:${cat.color}">${cat.label} · ${stop.price}</div>
              </div>
            </div>
            ${hoursWarn}
            <div class="tl-dwell">
              <span class="dwell-label">⏱ Thời gian ở:</span>
              <div class="dwell-adj">
                <button class="dwell-btn" data-action="minus" data-idx="${i}">−</button>
                <span class="dwell-num" id="dwell${i}">${stop.dwell}p</span>
                <button class="dwell-btn" data-action="plus" data-idx="${i}">+</button>
              </div>
            </div>
            <div class="tl-time" id="stopTime${i}">Đến ${fmtClock(stop.arrivalClock)} → Rời ${fmtClock(stop.departureClock)}</div>
            <a href="${gmapsUrl(stop)}"
               target="_blank" rel="noopener" class="r-gmaps-link" style="margin-top:8px">
               🗺️ Mở Google Maps
            </a>
          </div>
        </div>
      </div>`;
    });

    if (State.itinerary.length) {
      const last = State.itinerary[State.itinerary.length-1];
      html += `<div class="tl-item">
        <div class="tl-spine"><div class="tl-dot" style="background:#FFF3B0;border-color:#B98A00;font-size:.85rem">🏁</div></div>
        <div class="tl-content"><div class="tl-start" style="color:#B98A00" id="endTimeNode">Kết thúc chuyến ăn · ${fmtClock(last.departureClock)}</div></div>
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
        if (dwellEl) dwellEl.textContent = s.dwell+'p';
        if (timeEl) timeEl.textContent = `Đến ${fmtClock(s.arrivalClock)} → Rời ${fmtClock(s.departureClock)}`;
      }
      const endNode = document.getElementById('endTimeNode');
      if (endNode) {
        const last = State.itinerary[State.itinerary.length-1];
        endNode.textContent = `Kết thúc chuyến ăn · ${fmtClock(last.departureClock)}`;
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
      <button class="pmap-btn" id="pmapZoomIn" title="Phóng to">＋</button>
      <button class="pmap-btn" id="pmapZoomOut" title="Thu nhỏ">－</button>
      <button class="pmap-btn pmap-fit" id="pmapFit" title="Xem toàn lộ trình">⤢</button>
      <button class="pmap-btn pmap-locate" id="pmapLocate" title="Vị trí của tôi (realtime)">📍</button>
      <button class="pmap-btn pmap-fs" id="pmapFs" title="Toàn màn hình">⛶</button>
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
    startBtn.setAttribute('aria-label', 'Bắt đầu dẫn đường');
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
      document.getElementById('resultsScreen').classList.remove('hidden');
      document.getElementById('planScreen').classList.add('hidden');
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
      btn.title = isFs ? 'Thoát toàn màn hình (Esc)' : 'Toàn màn hình';
    }
    // Leaflet needs to recompute size after the container resizes;
    // wait past the ribbon/tabbar slide (0.32s) before invalidating
    // so the map fills the newly-freed pixels in one pass.
    setTimeout(() => State.planMap.invalidateSize(), 340);
    if (isFs) {
      this._startLiveTracking();
      showToast('🛰 Đang theo dõi vị trí realtime');
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
      showToast('🛰 Đang lấy GPS, đợi vài giây…');
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
        showToast(`🧭 Đi tới ${nearest.name} · còn ${label}`);
      } else {
        showToast('🧭 Đi theo dấu chấm xanh nhé!');
      }
    } else {
      showToast('🧭 Đi theo dấu chấm xanh nhé!');
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
    if (!navigator.geolocation) { showToast('⚠️ Trình duyệt không hỗ trợ GPS'); return; }
    this._watchId = navigator.geolocation.watchPosition(
      pos => this._onLiveFix(pos),
      err => {
        const msgs = {1: '🚫 Bạn từ chối vị trí', 2: '⚠️ Không lấy được vị trí', 3: '⏱ GPS timeout'};
        showToast(msgs[err.code] || '⚠️ Lỗi GPS');
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
    document.getElementById('avatarBtn').addEventListener('click', () => {
      const idx = AVATARS.indexOf(State.profile.avatar);
      const next = AVATARS[(idx+1) % AVATARS.length];
      State.profile.avatar = next;
      document.getElementById('avatarBtn').textContent = next;
      Storage.save();
    });

    const nameInput = document.getElementById('profileNameInput');
    nameInput.addEventListener('input', () => {
      State.profile.name = nameInput.value;
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

    // "Thêm quán" giờ hợp nhất về modal cộng đồng — đăng nhập là đăng thẳng
    // lên server, không còn tách riêng bản nháp chỉ lưu máy nữa.
    document.getElementById('addRestaurantBtn').addEventListener('click', () => {
      if (!Community.isLoggedIn()) {
        showToast('⚠️ Đăng nhập ở tab Cộng đồng để đăng quán nhé');
        TabNav.switchTo('community');
        return;
      }
      CommunityAddModal.open();
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
        if (!v) { showToast('⚠️ Dán API key trước nhé!'); return; }
        if (v.length < 20) { showToast('⚠️ Key không hợp lệ (quá ngắn)'); return; }
        Gemini.userKey = v;
        keyInput.value = '';
        HomeCtrl._scanCache?.clear?.();
        this._renderAiStatus();
        showToast('✅ Đã lưu key riêng · quét lại để dùng');
      });
    }
    if (keyClear) {
      keyClear.addEventListener('click', () => {
        Gemini.clearKey();
        if (keyInput) keyInput.value = '';
        HomeCtrl._scanCache?.clear?.();
        this._renderAiStatus();
        showToast('↺ Đã chuyển về key mặc định');
      });
    }
  },

  _renderAiStatus() {
    const el = document.getElementById('aiStatus');
    if (!el) return;
    const custom = Gemini.usingCustomKey();
    const hasDefault = !!Gemini.defaultKey;
    if (custom) {
      el.textContent = '● Key riêng';
      el.style.color = '#2e9e5b';
    } else if (hasDefault) {
      el.textContent = '● Key mặc định';
      el.style.color = '#B92626';
    } else {
      el.textContent = '● Chưa có key';
      el.style.color = '#999';
    }
  },

  render() {
    document.getElementById('avatarBtn').textContent = State.profile.avatar;
    document.getElementById('profileNameInput').value = State.profile.name;
    document.querySelectorAll('.pref-chip').forEach(c => {
      c.classList.toggle('active', State.profile.prefs.has(c.dataset.pref));
    });
    this._renderStats();
    this._renderMyRestaurants();
    this._renderAiStatus();
  },

  _renderStats() {
    document.getElementById('statMyR').textContent = State.userRestaurants.length;
    document.getElementById('statTrips').textContent = State.profile.trips;
    const catPrefs = [...State.profile.prefs].filter(p => CATEGORIES[p]);
    const fav = catPrefs[0] ? CATEGORIES[catPrefs[0]].icon : '🍽️';
    document.getElementById('statFav').textContent = fav;
  },

  _onStatClick(stat) {
    if (stat === 'myR') {
      HistoryModal.openMyQuan();
    } else if (stat === 'trips') {
      HistoryModal.openTrips();
    } else if (stat === 'fav') {
      const catPrefs = [...State.profile.prefs].filter(p => CATEGORIES[p]);
      if (catPrefs.length === 0) {
        showToast('Chọn loại quán bạn thích ở dưới nhé 👇');
      } else {
        const labels = catPrefs.map(p => CATEGORIES[p].label).join(', ');
        showToast(`🍽️ Bạn hay thích: ${labels}`);
      }
      document.getElementById('prefChips')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },

  _renderMyRestaurants() {
    const list = document.getElementById('myRestaurantList');
    if (State.userRestaurants.length === 0) {
      list.innerHTML = `<div class="empty-my-r">
        <div class="em-icon">📝</div>
        <div class="em-msg">Chưa có quán nào</div>
        <div class="em-sub">Thêm quán bạn từng ghé để dùng cho chuyến sau</div>
      </div>`;
      return;
    }
    list.innerHTML = State.userRestaurants.map(r => {
      const cat = CATEGORIES[r.cat];
      const thumb = r.image
        ? `<div class="my-r-icon" style="background-image:url('${r.image}');background-size:cover;background-position:center"></div>`
        : `<div class="my-r-icon" style="background:${cat.color}22;color:${cat.color}">${cat.icon}</div>`;
      return `<div class="my-r-card" data-id="${r.id}" role="button" tabindex="0" title="Nhấn để xem chi tiết">
        ${thumb}
        <div class="my-r-info">
          <div class="my-r-name">${r.name}</div>
          <div class="my-r-meta">${cat.label} · 💰 ${r.price}</div>
          <div class="my-r-desc">${r.desc || 'Không có mô tả'}</div>
        </div>
        <button class="my-r-del" data-id="${r.id}" title="Xoá quán">🗑</button>
      </div>`;
    }).join('');

    list.querySelectorAll('.my-r-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const r = State.userRestaurants.find(x => x.id === id);
        if (!r) return;
        if (confirm(`Xoá quán "${r.name}"?`)) {
          State.userRestaurants = State.userRestaurants.filter(x => x.id !== id);
          Storage.save();
          this._renderMyRestaurants();
          this._renderStats();
          HomeCtrl._updateBadge();
          showToast('🗑 Đã xoá quán');
        }
      });
    });

    list.querySelectorAll('.my-r-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.id);
        const r = State.userRestaurants.find(x => x.id === id);
        if (r) DetailModal.open(r);
      });
    });
  },
};

/* ═══════════════════════════════════════════════
   ADD RESTAURANT MODAL
═══════════════════════════════════════════════ */
const AddModal = {
  _selectedCat: 'restaurant',
  _pickedLat: null,
  _pickedLng: null,

  init() {
    document.getElementById('fCatPicker').addEventListener('click', e => {
      const btn = e.target.closest('.cat-pick-btn');
      if (!btn) return;
      document.querySelectorAll('.cat-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._selectedCat = btn.dataset.cat;
    });

    document.getElementById('fCancel').addEventListener('click', () => this.close());
    document.getElementById('addModal').addEventListener('click', e => {
      if (e.target.id === 'addModal') this.close();
    });
    
    let tempImageBase64 = null;
    const fImage = document.getElementById('fImage');
    const fImagePreview = document.getElementById('fImagePreview');
    const previewImg = fImagePreview ? fImagePreview.querySelector('img') : null;

    if (fImage) {
      fImage.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) {
          tempImageBase64 = null;
          if (fImagePreview) fImagePreview.style.display = 'none';
          return;
        }
        const reader = new FileReader();
        reader.onload = ev => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_DIM = 600;
            let w = img.width, h = img.height;
            if (w > MAX_DIM || h > MAX_DIM) {
              if (w > h) { h = h * (MAX_DIM / w); w = MAX_DIM; }
              else { w = w * (MAX_DIM / h); h = MAX_DIM; }
            }
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            tempImageBase64 = canvas.toDataURL('image/jpeg', 0.8);
            if (previewImg) {
              previewImg.src = tempImageBase64;
              fImagePreview.style.display = 'block';
            }
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    document.getElementById('fSave').addEventListener('click', () => this._save());

    // Address autocomplete — picking a suggestion drops the marker + prefills
    // the name if it's still blank; user can also tap the map directly.
    LocationPicker.initSearch('fLocSearch', 'fLocSuggest', (r) => {
      this._pickedLat = r.lat;
      this._pickedLng = r.lng;
      if (State.pickerMap) {
        State.pickerMap.setView([r.lat, r.lng], 17);
        LocationPicker.setMarker('pickerMap', 'pickerMarker', r.lat, r.lng, this._selectedCat);
      }
      const nameInput = document.getElementById('fName');
      if (nameInput && !nameInput.value.trim()) nameInput.value = r.name;
      document.getElementById('fLocSearch').value = r.name;
      Geocoder.hide(document.getElementById('fLocSuggest'));
    });
  },

  open() {
    const modal = document.getElementById('addModal');
    modal.classList.add('show');
    document.getElementById('fName').value = '';
    document.getElementById('fPrice').value = '';
    document.getElementById('fDesc').value = '';
    const fLoc = document.getElementById('fLocSearch');
    if (fLoc) fLoc.value = '';
    const fLocSug = document.getElementById('fLocSuggest');
    if (fLocSug) Geocoder.hide(fLocSug);
    this._selectedCat = 'restaurant';
    document.querySelectorAll('.cat-pick-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.cat === 'restaurant');
    });
    // Start with NO location picked. User picks by:
    //  1) selecting a suggestion from the address search
    //  2) tapping the picker map
    //  3) leaving text in the address input — we auto-geocode it on save
    // The map centers on a default view but drops no marker until the
    // user actually chooses somewhere.
    this._pickedLat = null;
    this._pickedLng = null;
    // No marker on open — dropped only when the user picks or clicks.
    const center = [State.userLat || 21.0285, State.userLng || 105.8542];
    setTimeout(() => {
      LocationPicker.initMap('pickerMap', 'pickerMap', 'pickerMarker', center, (lat, lng) => {
        this._pickedLat = lat;
        this._pickedLng = lng;
        LocationPicker.setMarker('pickerMap', 'pickerMarker', lat, lng, this._selectedCat);
      });
    }, 250);
  },

  close() {
    document.getElementById('addModal').classList.remove('show');
    setTimeout(() => LocationPicker.teardownMap('pickerMap'), 300);
  },

  async _save() {
    const name = document.getElementById('fName').value.trim();
    if (!name) { showToast('⚠️ Nhập tên quán trước nhé!'); return; }

    const price = document.getElementById('fPrice').value.trim() || '—';
    const desc = document.getElementById('fDesc').value.trim();
    const addressText = (document.getElementById('fLocSearch')?.value || '').trim();

    let lat = this._pickedLat;
    let lng = this._pickedLng;
    let locSource = lat != null ? 'picked' : 'none';

    // No coords yet, but user typed something in the address field →
    // auto-geocode it. Many personal picks don't exist on OSM as
    // named nodes (small stall, home-based kitchen, brand-new spot),
    // so we try progressively shorter query variants: full text, then
    // "street, district", then "district", then "city". The nearest
    // hit within a reasonable radius wins.
    if (lat == null && addressText.length >= 3) {
      const saveBtn = document.getElementById('fSave');
      const originalText = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = '🌐 Đang tra vị trí…';
      try {
        const bias = { nearLat: State.userLat, nearLng: State.userLng };
        const CLOSE_KM = 20;   // "definitely the right area"
        const FAR_KM = 60;     // > this → almost certainly a wrong match

        // Build the query ladder: full → strip leading parts one by one.
        const parts = addressText.split(',').map(p => p.trim()).filter(Boolean);
        const queries = [addressText];
        for (let i = 1; i < parts.length; i++) {
          queries.push(parts.slice(i).join(', '));
        }

        let best = null;
        for (const q of queries) {
          const results = await Geocoder.search(q, bias);
          if (!results || !results.length) continue;
          // Address field: reject landmarks/POIs — a user typing
          // "10 phố X quận Y" wants that street/district, not the
          // nearest tourist monument.
          const addressOnly = results.filter(r => Geocoder.isAddressType(r));
          if (!addressOnly.length) continue;
          const top = addressOnly[0]; // Geocoder already sorted by distance
          const d = top._distKm ?? Infinity;
          if (!best || d < best.dist) best = { top, dist: d, q };
          if (d <= CLOSE_KM) break; // close enough — stop peeling
        }

        if (best && best.dist <= CLOSE_KM) {
          lat = best.top.lat; lng = best.top.lng;
          locSource = best.q === addressText ? 'geocoded' : 'approximate';
        } else if (best && best.dist <= FAR_KM) {
          const ok = confirm(
            `Không tìm thấy chính xác. Chọn vị trí gần đúng:\n` +
            `"${best.top.name}${best.top.sub ? ' · ' + best.top.sub : ''}" ` +
            `(cách ${Math.round(best.dist)}km)?\n\n` +
            `OK để dùng. Cancel để lưu không kèm map — nhấn map trong lần chỉnh sau.`
          );
          if (ok) { lat = best.top.lat; lng = best.top.lng; locSource = 'approximate'; }
        }
        // else: nothing usable — leave lat/lng null, user gets the
        // "chưa gắn vị trí" toast and can tap map on next edit.
      } catch (e) {
        console.warn('[Save] geocode error:', e);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
    }

    // Still no coords → allow save as a "memory only" entry. Google Maps
    // link and route features won't work, but the user's note is kept.
    const hasCoords = lat != null && lng != null;

    const newId = 1001 + State.userRestaurants.length + Math.floor(Math.random() * 1000);
    const previewImg = document.querySelector('#fImagePreview img');
    const image = (previewImg && document.getElementById('fImagePreview').style.display !== 'none')
      ? previewImg.src
      : null;

    State.userRestaurants.push({
      id: newId,
      name,
      cat: this._selectedCat,
      price,
      desc: desc || 'Quán do bạn thêm ⭐',
      address: addressText || null,
      lat: hasCoords ? lat : null,
      lng: hasCoords ? lng : null,
      rating: 5.0,
      hours: '',
      image,
    });
    Storage.save();

    ProfileCtrl._renderMyRestaurants();
    ProfileCtrl._renderStats();
    HomeCtrl._updateBadge();

    if (locSource === 'geocoded') {
      showToast(`✅ Đã thêm "${name}" · tự tìm vị trí`);
    } else if (locSource === 'approximate') {
      showToast(`✅ Đã thêm "${name}" · vị trí gần đúng`);
    } else if (locSource === 'picked') {
      showToast(`✅ Đã thêm "${name}"`);
    } else {
      showToast(`✅ Lưu "${name}" · chưa gắn vị trí — nhấn map để chỉnh`);
    }
    this.close();
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
        showToast('Quán chưa có vị trí trên bản đồ');
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
      <div class="detail-desc">${escape(r.desc || 'Không có mô tả')}</div>
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
    const myModal = document.getElementById('myQuanModal');
    const tripsModal = document.getElementById('tripsModal');
    document.getElementById('myQuanClose').addEventListener('click', () => this._close(myModal));
    document.getElementById('tripsClose').addEventListener('click', () => this._close(tripsModal));
    myModal.addEventListener('click', e => { if (e.target === myModal) this._close(myModal); });
    tripsModal.addEventListener('click', e => { if (e.target === tripsModal) this._close(tripsModal); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (myModal.classList.contains('show')) this._close(myModal);
      if (tripsModal.classList.contains('show')) this._close(tripsModal);
    });
  },

  _close(el) { el.classList.remove('show'); },

  // ── Quán của tôi — grid of r-card-style tiles (same look as scan results)
  openMyQuan() {
    const list = State.userRestaurants || [];
    document.getElementById('myQuanCount').textContent = `${list.length} quán`;
    const body = document.getElementById('myQuanBody');
    if (list.length === 0) {
      body.innerHTML = `
        <div class="list-empty">
          <div class="list-empty-icon">📝</div>
          <div class="list-empty-msg">Chưa có quán nào</div>
          <div class="list-empty-sub">Nhấn "＋ Thêm quán" để thêm quán đầu tiên</div>
        </div>`;
    } else {
      const esc = this._esc;
      body.innerHTML = `<div class="r-grid">${list.map(r => {
        const cat = CATEGORIES[r.cat] || { label: '—', color: '#888', icon: '🍽️' };
        const img = r.image ? `<img class="r-img-mini" src="${r.image}" alt="${esc(r.name)}">` : '';
        return `<div class="r-card user-added" data-id="${r.id}" role="button" tabindex="0" title="Xem chi tiết">
          ${img}
          <div class="r-cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${esc(cat.label)}</div>
          <div class="r-name">${esc(r.name)}</div>
          <div class="r-price">💰 ${esc(r.price || '—')}</div>
          <div class="r-desc">${esc(r.desc || '')}</div>
        </div>`;
      }).join('')}</div>`;
      body.querySelectorAll('.r-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = parseInt(card.dataset.id);
          const r = State.userRestaurants.find(x => x.id === id);
          if (r) DetailModal.open(r);
        });
      });
    }
    document.getElementById('myQuanModal').classList.add('show');
  },

  // ── Lịch sử chuyến ăn — flat name+address bars per stop
  openTrips() {
    const trips = State.profile.tripHistory || [];
    document.getElementById('tripsCount').textContent = `${trips.length} chuyến`;
    const body = document.getElementById('tripsBody');
    if (trips.length === 0) {
      body.innerHTML = `
        <div class="list-empty">
          <div class="list-empty-icon">🍜</div>
          <div class="list-empty-msg">Chưa có chuyến nào</div>
          <div class="list-empty-sub">Quét quán → chọn vài chỗ → nhấn "Lên lịch" để tạo chuyến đầu tiên</div>
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
              <div class="trip-stop-addr">${esc(s.address || (s.lat != null ? `📍 ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : 'Chưa có địa chỉ'))}</div>
            </div>
          </div>`).join('');
        return `
          <div class="trip-item">
            <div class="trip-date">📅 ${dateLabel} · ${trip.stops.length} điểm</div>
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
    }
    document.getElementById('tripsModal').classList.add('show');
  },

  _formatDate(d) {
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (sameDay) return `Hôm nay ${time}`;
    if (isYesterday) return `Hôm qua ${time}`;
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
const COMMUNITY_PRICE_LABEL = { binh_dan: '💸 Bình dân', tam_trung: '💰 Tầm trung', sang_chanh: '✨ Sang chảnh' };

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

    document.getElementById('communityLogout').addEventListener('click', () => {
      Community.logout();
      showToast('👋 Đã đăng xuất');
      this.render();
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

  // ── Friends ("quán đăng chế độ Bạn bè chỉ hiện với người ở đây") ─────────
  _initFriendSearch() {
    const input = document.getElementById('friendSearchInput');
    const results = document.getElementById('friendSearchResults');
    if (!input || !results) return;

    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (q.length < 2) { results.classList.remove('show'); results.innerHTML = ''; return; }
      debounce = setTimeout(async () => {
        const r = await Community.searchUsers(q);
        const items = (r.ok ? r.data.items : []).filter(u => u.id !== Community.currentUser?.id);
        if (!items.length) {
          results.innerHTML = `<div class="go-empty">Không tìm thấy ai khớp "${escapeHtml(q)}"</div>`;
        } else {
          results.innerHTML = items.map(u => `<div class="go-item" data-id="${u.id}">👤 ${escapeHtml(u.name || 'Ẩn danh')}</div>`).join('');
          results.querySelectorAll('.go-item[data-id]').forEach(el => {
            el.addEventListener('click', async () => {
              const r2 = await Community.addFriend(el.dataset.id);
              if (!r2.ok) { showToast(`⚠️ ${r2.error}`); return; }
              showToast('✅ Đã thêm bạn');
              input.value = '';
              results.classList.remove('show'); results.innerHTML = '';
              this._renderFriends();
            });
          });
        }
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
      el.innerHTML = `<span style="font-size:.78rem;color:var(--text3)">Chưa có bạn nào — tìm ở trên để thêm</span>`;
      return;
    }
    el.innerHTML = friends.map(u => `<span class="chip-tag">👤 ${escapeHtml(u.name || 'Ẩn danh')}<button type="button" class="chip-tag-remove" data-id="${u.id}">✕</button></span>`).join('');
    el.querySelectorAll('.chip-tag-remove').forEach(b => {
      b.addEventListener('click', async () => {
        const r2 = await Community.removeFriend(b.dataset.id);
        if (!r2.ok) { showToast(`⚠️ ${r2.error}`); return; }
        this._renderFriends();
      });
    });
  },

  _renderAuthMode() {
    const isRegister = this._mode === 'register';
    document.getElementById('communityNameGroup').classList.toggle('hidden', !isRegister);
    document.getElementById('communityAuthSubmit').textContent = isRegister ? 'Đăng ký' : 'Đăng nhập';
    document.getElementById('communityAuthToggle').textContent = isRegister
      ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký';
  },

  async _submitAuth() {
    const email = document.getElementById('cAuthEmail').value.trim();
    const password = document.getElementById('cAuthPassword').value;
    const name = document.getElementById('cAuthName').value.trim();
    if (!email || !password) { showToast('⚠️ Điền email và mật khẩu'); return; }
    if (this._mode === 'register' && password.length < 8) { showToast('⚠️ Mật khẩu tối thiểu 8 ký tự'); return; }

    const btn = document.getElementById('communityAuthSubmit');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ Đang xử lý…';
    const r = this._mode === 'register'
      ? await Community.register(email, password, name)
      : await Community.login(email, password);
    btn.disabled = false; btn.textContent = original;

    if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
    showToast(this._mode === 'register' ? '🎉 Đã đăng ký!' : '✅ Đăng nhập thành công');
    document.getElementById('cAuthPassword').value = '';
    this.render();
  },

  render() {
    const loggedIn = Community.isLoggedIn();
    document.getElementById('communityAuth').classList.toggle('hidden', loggedIn);
    document.getElementById('communityMain').classList.toggle('hidden', !loggedIn);
    if (!loggedIn) return;
    const user = Community.currentUser;
    document.getElementById('communityWelcome').innerHTML = `Chào <em>${escapeHtml(user.name || user.email)}</em>`;
    this._renderFriends();
    this._loadList('');
  },

  async _loadList(query) {
    const list = document.getElementById('communityList');
    list.innerHTML = `<div class="empty-comm"><div class="em-icon">⏳</div><div class="em-msg">Đang tải…</div></div>`;
    const r = query ? await Community.searchRestaurants(query) : await Community.listRestaurants();
    if (!r.ok) {
      list.innerHTML = `<div class="empty-comm">
        <div class="em-icon">😕</div><div class="em-msg">Không tải được</div>
        <div class="em-sub">${escapeHtml(r.error)}</div>
      </div>`;
      return;
    }
    this._renderList(r.data.items);
  },

  _renderList(items) {
    const list = document.getElementById('communityList');
    if (!items.length) {
      list.innerHTML = `<div class="empty-comm">
        <div class="em-icon">🍽️</div>
        <div class="em-msg">Chưa có quán nào</div>
        <div class="em-sub">Đăng quán đầu tiên cho cả nhóm!</div>
      </div>`;
      return;
    }
    list.innerHTML = items.map(r => this._cardHtml(r)).join('');
    list.querySelectorAll('.vote-btn').forEach(btn => {
      btn.addEventListener('click', () => this._onVoteClick(btn));
    });
    items.forEach(r => this._loadVoteState(r.id));
  },

  _VIS_BADGE: { private: '🔒', friends: '👥', public: '🌍' },

  _cardHtml(r) {
    const catKey = COMMUNITY_PB_TO_CAT[r.category] || 'restaurant';
    const cat = CATEGORIES[catKey];
    const priceLabel = COMMUNITY_PRICE_LABEL[r.price_range] || '';
    const thumbUrl = Community.thumbnailUrl(r, '500x360');
    const cover = thumbUrl
      ? `<div class="comm-r-cover" style="background-image:url('${thumbUrl}')"></div>`
      : `<div class="comm-r-cover" style="background:${cat.color}22">${cat.icon}</div>`;
    const tagsHtml = (r.tags || []).map(t => `<span class="comm-r-chip">${escapeHtml(t)}</span>`).join('');
    const hashHtml = (r.hashtags || []).map(h => `<span class="comm-r-chip hashtag">#${escapeHtml(h)}</span>`).join('');
    const authorName = (r.expand && r.expand.created_by && r.expand.created_by.name) || 'Ẩn danh';
    const visBadge = this._VIS_BADGE[r.visibility] || '';
    return `<div class="comm-r-card">
      ${cover}
      <div class="comm-r-body">
        <div class="comm-r-name">${escapeHtml(r.name)}</div>
        <div class="comm-r-meta">${cat.icon} ${cat.label}${priceLabel ? ' · ' + priceLabel : ''} · ${visBadge}</div>
        ${r.description ? `<div class="comm-r-desc">${escapeHtml(r.description)}</div>` : ''}
        ${(tagsHtml || hashHtml) ? `<div class="comm-r-chips">${tagsHtml}${hashHtml}</div>` : ''}
        <div class="comm-r-footer">
          <span class="comm-r-author">👤 ${escapeHtml(authorName)}</span>
          <button class="vote-btn" data-id="${r.id}"><span class="vote-ico">☆</span><span class="vote-count">···</span></button>
        </div>
      </div>
    </div>`;
  },

  // Kiểu GitHub: bấm ★ để "star" một quán, càng nhiều sao càng ngon. Vẫn
  // dùng đúng cơ chế vote (unique restaurant+user) phía server, chỉ đổi icon.
  async _loadVoteState(restaurantId) {
    const [mine, count] = await Promise.all([
      Community.myVote(restaurantId),
      Community.voteCount(restaurantId),
    ]);
    const btn = document.querySelector(`.vote-btn[data-id="${restaurantId}"]`);
    if (!btn) return;
    btn.classList.toggle('voted', !!mine);
    btn.querySelector('.vote-ico').textContent = mine ? '★' : '☆';
    btn.querySelector('.vote-count').textContent = count;
  },

  async _onVoteClick(btn) {
    const id = btn.dataset.id;
    btn.disabled = true;
    const r = await Community.toggleVote(id);
    btn.disabled = false;
    if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
    this._loadVoteState(id);
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
      if (files.length > room) showToast(`⚠️ Chỉ nhận thêm được ${room} ảnh (tối đa 4)`);
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
      if (arr.length >= max) { showToast(`⚠️ Tối đa ${max} ${hashtag ? 'hashtag' : 'thẻ'}`); return; }
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
    const slots = this._photoFiles.map((file, i) => {
      const url = this._photoPreviewUrls[i];
      const starActive = i === this._thumbIndex ? ' active' : '';
      return `<div class="photo-slot" style="background-image:url('${url}')">
        <button type="button" class="photo-slot-remove" data-idx="${i}">✕</button>
        <button type="button" class="photo-thumb-star${starActive}" data-idx="${i}" title="Đặt làm ảnh đại diện">⭐</button>
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

  open() {
    if (!Community.isLoggedIn()) { showToast('⚠️ Cần đăng nhập trước'); return; }
    const modal = document.getElementById('communityAddModal');
    modal.classList.add('show');
    document.getElementById('cfName').value = '';
    document.getElementById('cfDesc').value = '';
    const loc = document.getElementById('cfLocSearch');
    if (loc) loc.value = '';
    const locSug = document.getElementById('cfLocSuggest');
    if (locSug) Geocoder.hide(locSug);

    this._selectedCat = 'restaurant';
    this._selectedPrice = 'binh_dan';
    this._selectedVisibility = 'public';
    document.querySelectorAll('#cfCatPicker .cat-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === 'restaurant'));
    document.querySelectorAll('#cfPricePicker .cat-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.price === 'binh_dan'));
    document.querySelectorAll('#cfVisibilityPicker .cat-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.vis === 'public'));

    this._pickedLat = null;
    this._pickedLng = null;

    this._tags.length = 0;
    this._hashtags.length = 0;
    this._renderChipList('cfTagList', this._tags, false);
    this._renderChipList('cfHashtagList', this._hashtags, true);

    this._photoPreviewUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch(_) {} });
    this._photoFiles.length = 0;
    this._photoPreviewUrls.length = 0;
    this._thumbIndex = 0;
    this._renderPhotoGrid();

    const center = [State.userLat || 21.0285, State.userLng || 105.8542];
    setTimeout(() => {
      LocationPicker.initMap('communityPickerMap', 'communityPickerMap', 'communityPickerMarker', center, (lat, lng) => {
        this._pickedLat = lat;
        this._pickedLng = lng;
        LocationPicker.setMarker('communityPickerMap', 'communityPickerMarker', lat, lng, this._selectedCat);
      });
    }, 250);
  },

  close() {
    document.getElementById('communityAddModal').classList.remove('show');
    setTimeout(() => LocationPicker.teardownMap('communityPickerMap'), 300);
  },

  async _save() {
    const name = document.getElementById('cfName').value.trim();
    if (!name) { showToast('⚠️ Nhập tên quán trước nhé!'); return; }
    if (!Community.isLoggedIn()) { showToast('⚠️ Cần đăng nhập trước'); return; }

    const desc = document.getElementById('cfDesc').value.trim();
    const addressText = (document.getElementById('cfLocSearch')?.value || '').trim();
    let lat = this._pickedLat, lng = this._pickedLng;

    const btn = document.getElementById('cfSave');
    const original = btn.textContent;

    if (lat == null && addressText.length >= 3) {
      btn.disabled = true; btn.textContent = '🌐 Đang tra vị trí…';
      const found = await LocationPicker.geocodeFallback(addressText);
      if (found) { lat = found.lat; lng = found.lng; }
    }

    btn.disabled = true; btn.textContent = '📤 Đang đăng…';

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
    showToast(`✅ Đã đăng "${name}" cho cộng đồng!`);
    this.close();
    CommunityCtrl._loadList('');
  },
};
