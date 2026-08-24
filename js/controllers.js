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

    input.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (q.length < 3) { Geocoder.hide(suggest); return; }
      Geocoder.showLoading(suggest);
      Geocoder.onInput('locInput', q, 450, (results) => {
        Geocoder.renderSuggestions(suggest, results, pick);
      });
    });

    // Enter picks the first suggestion, or triggers a scan if nothing typed
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = input.value.trim();
      if (!q) { this.scan(); return; }
      Geocoder.showLoading(suggest);
      const results = await Geocoder.search(q);
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
    return `${State.userLat.toFixed(3)}_${State.userLng.toFixed(3)}_${State.radius}_${cats}`;
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
        const results = await Geocoder.search(typedQ.replace(/^📌\s*/, ''));
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

      // ── Gemini + OSM chạy SONG SONG; lấy kết quả nào về trước ──────────
      const geminiP = useGemini
        ? Gemini.findQuan(State.userLat, State.userLng, State.radius,
            { categories: activeCats, limit: 20 })
            .catch(e => { console.warn('[Gemini]', e.message); return []; })
        : Promise.resolve([]);

      const osmP = POI.fetch(State.userLat, State.userLng, State.radius)
        .catch(e => { console.warn('[OSM]', e.message); return []; });

      // Race: hiển thị ngay khi có kết quả; hard cap 20s
      const raceResult = await new Promise(resolve => {
        let done = false;
        let finished = 0;
        const total = useGemini ? 2 : 1;

        const finish = (it, src) => {
          finished++;
          if (done) return;
          if (it.length) {
            done = true;
            resolve({ items: it, source: src });
          } else if (finished >= total) {
            done = true;
            resolve({ items: [], source: 'none' });
          }
        };

        geminiP.then(r => finish(r, 'gemini'));
        osmP.then(r => finish(r, 'osm'));

        // Hard 20s total cap
        setTimeout(() => {
          if (!done) { done = true; resolve({ items: [], source: 'none' }); }
        }, 20000);
      });

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
    }

    this._doScan();
  },

  _srcOf(r) {
    if (r._gemini) return 'osm';   // treat gemini as part of "osm" source bucket
    if (r.id >= 1e13) return 'osm';
    return 'mine';
  },

  _doScan() {
    const pool = allRestaurants();
    const results = pool.filter(r => {
      const src = this._srcOf(r);
      if (!State.activeSrcs.has(src)) return false;
      if (!State.activeCats.has(r.cat)) return false;
      if (State.minRating > 0 && (r.rating || 0) < State.minRating) return false;
      const dist = haversine(State.userLat, State.userLng, r.lat, r.lng);
      if (dist > State.radius) return false;
      r._dist = dist;
      return true;
    });

    if (results.length === 0) {
      let hint = 'Thử tăng bán kính hoặc bật GPS ở vị trí khác';
      if (!State.activeSrcs.has('osm')) hint = 'Bật 🌐 OpenStreetMap để tìm quán';
      showToast(`🤔 Không tìm thấy quán · ${hint}`);
      // Clear markers if no results
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
      grid.innerHTML = `<div class="empty-state"><div class="es-icon">🍽️</div><div class="es-msg">Không có quán loại này<br>trong bán kính tìm kiếm</div></div>`;
      return;
    }
    grid.innerHTML = visible.map((r, i) => {
      const cat = CATEGORIES[r.cat];
      const sel = State.selected.has(r.id);
      const userAdded = r.id >= 1001 && r.id < 1e12;
      const isGemini = !!r._gemini;
      const isOsm = r.id >= 1e13 && !isGemini;
      const flagCls = userAdded ? ' user-added' : (isGemini ? ' gemini-added' : (isOsm ? ' osm-added' : ''));
      const priceLabel = r.price && r.price !== '—' ? `💰 ${r.price}` : '💰 —';
      const ratingLabel = isGemini ? `${r.rating.toFixed(1)} ★` : (isOsm ? '🌐 OSM' : `${r.rating} ★`);
      const hoursBadge = this._renderHoursBadge(r);
      return `<div class="r-card${sel?' selected':''}${flagCls}" data-id="${r.id}" style="animation-delay:${Math.min(i,10)*30}ms">
        <div class="r-cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${cat.label}</div>
        <div class="r-name">${r.name}</div>
        ${hoursBadge}
        <div class="r-price">${priceLabel}</div>
        <div class="r-desc">${r.desc}</div>
        <div class="r-meta">
          <span class="r-rating">${ratingLabel}</span>
          <span class="r-dist">${fmtDist(r._dist)}</span>
        </div>
        <a href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}" 
           target="_blank" class="r-gmaps-link" onclick="event.stopPropagation()">
           🗺️ Mở Google Maps
        </a>
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
      if (State.selected.has(id)) {
        State.selected.delete(id);
        card.classList.remove('selected');
      } else {
        if (State.selected.size >= 6) { showToast('Tối đa 6 quán mỗi chuyến 😄'); return; }
        State.selected.add(id);
        card.classList.add('selected');
      }
      this._updatePlanBtn();
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

    State.profile.trips++;
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
            <a href="https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}" 
               target="_blank" class="r-gmaps-link" style="margin-top:8px">
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

    // Overlay controls: zoom + fit-bounds button
    const wrap = document.getElementById('planMapWrap');
    let ctrl = wrap.querySelector('.pmap-controls');
    if (ctrl) ctrl.remove();
    ctrl = document.createElement('div');
    ctrl.className = 'pmap-controls';
    ctrl.innerHTML = `
      <button class="pmap-btn" id="pmapZoomIn" title="Phóng to">＋</button>
      <button class="pmap-btn" id="pmapZoomOut" title="Thu nhỏ">－</button>
      <button class="pmap-btn pmap-fit" id="pmapFit" title="Xem toàn lộ trình">⤢</button>
    `;
    wrap.appendChild(ctrl);
    document.getElementById('pmapZoomIn').addEventListener('click', () => State.planMap.zoomIn());
    document.getElementById('pmapZoomOut').addEventListener('click', () => State.planMap.zoomOut());
    document.getElementById('pmapFit').addEventListener('click', () => State.planMap.fitBounds(bounds.pad(0.25)));

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
      document.getElementById('resultsScreen').classList.remove('hidden');
      document.getElementById('planScreen').classList.add('hidden');
    });
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

    document.getElementById('addRestaurantBtn').addEventListener('click', () => {
      AddModal.open();
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
  },

  render() {
    document.getElementById('avatarBtn').textContent = State.profile.avatar;
    document.getElementById('profileNameInput').value = State.profile.name;
    document.querySelectorAll('.pref-chip').forEach(c => {
      c.classList.toggle('active', State.profile.prefs.has(c.dataset.pref));
    });
    this._renderStats();
    this._renderMyRestaurants();
  },

  _renderStats() {
    document.getElementById('statMyR').textContent = State.userRestaurants.length;
    document.getElementById('statTrips').textContent = State.profile.trips;
    const catPrefs = [...State.profile.prefs].filter(p => CATEGORIES[p]);
    const fav = catPrefs[0] ? CATEGORIES[catPrefs[0]].icon : '🍽️';
    document.getElementById('statFav').textContent = fav;
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

    // Address autocomplete inside the modal
    this._initLocSearch();
  },

  // Debounced address suggestions for the modal address input.
  // Selecting a suggestion drops the picker marker at that spot and pans
  // the picker map — user can still tap the map for fine adjustment.
  _initLocSearch() {
    const input = document.getElementById('fLocSearch');
    const suggest = document.getElementById('fLocSuggest');
    if (!input || !suggest) return;

    const pick = (r) => {
      this._pickedLat = r.lat;
      this._pickedLng = r.lng;
      // Update marker + map view
      if (State.pickerMap) {
        State.pickerMap.setView([r.lat, r.lng], 17);
        this._setMarker(r.lat, r.lng);
      }
      // Prefill name if the input's blank — most convenient
      const nameInput = document.getElementById('fName');
      if (nameInput && !nameInput.value.trim()) nameInput.value = r.name;
      input.value = r.name;
      Geocoder.hide(suggest);
    };

    input.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (q.length < 3) { Geocoder.hide(suggest); return; }
      Geocoder.showLoading(suggest);
      Geocoder.onInput('fLocSearch', q, 450, (results) => {
        Geocoder.renderSuggestions(suggest, results, pick);
      });
    });

    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      Geocoder.showLoading(suggest);
      const results = await Geocoder.search(q);
      if (results.length) pick(results[0]);
      else Geocoder.renderSuggestions(suggest, [], pick);
    });

    // Dismiss dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#fLocSearch') && !e.target.closest('#fLocSuggest')) {
        Geocoder.hide(suggest);
      }
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
    this._pickedLat = State.userLat || 10.7769;
    this._pickedLng = State.userLng || 106.7009;
    setTimeout(() => this._initPickerMap(), 250);
  },

  close() {
    document.getElementById('addModal').classList.remove('show');
    setTimeout(() => {
      if (State.pickerMap) { try { State.pickerMap.remove(); } catch(_){} State.pickerMap = null; }
    }, 300);
  },

  _initPickerMap() {
    if (State.pickerMap) { try { State.pickerMap.remove(); } catch(_){} State.pickerMap = null; }
    const lat = this._pickedLat, lng = this._pickedLng;
    State.pickerMap = L.map('pickerMap', {
      center:[lat,lng], zoom:15,
      zoomControl:false, attributionControl:false,
    });
    TileLayer.add(State.pickerMap);
    this._setMarker(lat, lng);
    State.pickerMap.on('click', e => {
      const {lat, lng} = e.latlng;
      this._pickedLat = lat;
      this._pickedLng = lng;
      this._setMarker(lat, lng);
    });
  },

  _setMarker(lat, lng) {
    if (State.pickerMarker) State.pickerMarker.remove();
    const cat = CATEGORIES[this._selectedCat];
    const icon = L.divIcon({
      html:`<div class="r-map-marker" style="background:${cat.color};font-size:1.05rem">${cat.icon}</div>`,
      iconSize:[32,32], iconAnchor:[16,16], className:''
    });
    State.pickerMarker = L.marker([lat,lng],{icon}).addTo(State.pickerMap);
  },

  _save() {
    const name = document.getElementById('fName').value.trim();
    const price = document.getElementById('fPrice').value.trim() || '—';
    const desc = document.getElementById('fDesc').value.trim();

    if (!name) { showToast('⚠️ Nhập tên quán trước nhé!'); return; }
    if (!this._pickedLat) { showToast('⚠️ Chọn vị trí trên bản đồ!'); return; }

    const newId = 1001 + State.userRestaurants.length + Math.floor(Math.random()*1000);
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
      lat: this._pickedLat,
      lng: this._pickedLng,
      rating: 5.0,
      hours: '',
      image,
    });
    Storage.save();

    ProfileCtrl._renderMyRestaurants();
    ProfileCtrl._renderStats();
    HomeCtrl._updateBadge();
    showToast(`✅ Đã thêm "${name}"`);
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
      const url = `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`;
      window.open(url, '_blank', 'noopener');
    });
  },

  open(r) {
    this._current = r;
    const cat = CATEGORIES[r.cat] || { label: '—', color: '#888', icon: '🍽️' };
    const body = document.getElementById('detailBody');
    const imgHtml = r.image
      ? `<div class="r-img-wrap"><img src="${r.image}" alt="${r.name}"></div>`
      : '';
    const coordsHtml = (r.lat != null && r.lng != null)
      ? `<div class="detail-coords">📍 ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</div>`
      : '';
    const escName = (r.name || '').replace(/</g, '&lt;');
    const escDesc = (r.desc || 'Không có mô tả').replace(/</g, '&lt;');
    const escPrice = (r.price || '—').replace(/</g, '&lt;');

    body.innerHTML = `
      ${imgHtml}
      <div class="detail-cat-wrap">
        <span class="detail-cat" style="color:${cat.color};background:${cat.color}18">${cat.icon} ${cat.label}</span>
      </div>
      <div class="detail-name">${escName}</div>
      <div class="detail-meta">
        <span>💰 ${escPrice}</span>
        <span>⭐ ${(r.rating ?? 5).toFixed(1)}</span>
        ${r.hours ? `<span>🕒 ${r.hours}</span>` : ''}
      </div>
      <div class="detail-desc">${escDesc}</div>
      ${coordsHtml}
    `;
    document.getElementById('detailModal').classList.add('show');
  },

  close() {
    document.getElementById('detailModal').classList.remove('show');
    this._current = null;
  },
};
