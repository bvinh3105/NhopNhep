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
      this._updateCatPillLabel();
    });

    // Bán kính — gộp thành 1 pill bên cạnh label "Điểm xuất phát", bấm để
    // đổi vòng qua các mốc (thay cho dãy 4 nút riêng trước đây).
    const RADIUS_STEPS = [500, 1000, 2000, 5000];
    const RADIUS_LABELS = ['500m', '1 km', '2 km', '5 km'];
    let radiusIdx = RADIUS_STEPS.indexOf(State.radius);
    if (radiusIdx === -1) radiusIdx = 1;
    document.getElementById('radiusPillBtn').addEventListener('click', () => {
      radiusIdx = (radiusIdx + 1) % RADIUS_STEPS.length;
      document.getElementById('radiusPillVal').textContent = RADIUS_LABELS[radiusIdx];
      State.radius = RADIUS_STEPS[radiusIdx];
      MapHome.updateRadius();
    });

    // Source chips (osm/mine/community — community is live now)
    document.getElementById('srcChips').addEventListener('click', e => {
      const chip = e.target.closest('.cat-chip');
      if (!chip) return;
      const src = chip.dataset.src;
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

    document.getElementById('gpsBtn').addEventListener('click', () => GPS.toggle());

    // Cụm nút nổi trên map (header full-bleed). GPS dùng chung logic thật
    // với #gpsBtn; bookmark/thông báo chưa có tính năng, chỉ báo tạm.
    document.getElementById('homeGpsFloatBtn').addEventListener('click', (e) => {
      // e.currentTarget is nulled out once the event finishes dispatching,
      // so it must be captured before the setTimeout callback runs.
      const btn = e.currentTarget;
      btn.classList.add('pulse');
      setTimeout(() => btn.classList.remove('pulse'), 300);
      GPS.toggle();
    });
    document.getElementById('homeBookmarkBtn').addEventListener('click', () => showToast('🚧 Tính năng đang cập nhật'));
    document.getElementById('homeBellBtn').addEventListener('click', () => showToast('🚧 Tính năng đang cập nhật'));

    // Dropdown "Tôi muốn ăn" — mở/đóng khi bấm pill "Loại quán" cạnh ô
    // "Tìm món/quán" (trước đây mở từ logo, đã chuyển xuống đây 2026-09-19
    // để logo chỉ còn easter egg). Popover xổ lên NGAY TẠI vị trí pill
    // (xem _positionCatDropdown) thay vì slide từ cạnh trên màn hình.
    const catToggle = document.getElementById('catPillBtn');
    const catDdPanel = document.getElementById('catDdPanel');
    const catDdOverlay = document.getElementById('catDdOverlay');
    const closeCatDd = () => {
      catToggle.classList.remove('open');
      catToggle.setAttribute('aria-expanded', 'false');
      catDdPanel.classList.remove('show');
      catDdOverlay.classList.remove('show');
      window.removeEventListener('resize', this._positionCatDropdownBound);
    };
    this._positionCatDropdownBound = () => this._positionCatDropdown();
    catToggle.addEventListener('click', () => {
      const opening = !catDdPanel.classList.contains('show');
      if (opening) {
        this._positionCatDropdown();
        window.addEventListener('resize', this._positionCatDropdownBound);
      } else {
        window.removeEventListener('resize', this._positionCatDropdownBound);
      }
      catToggle.classList.toggle('open', opening);
      catToggle.setAttribute('aria-expanded', String(opening));
      catDdPanel.classList.toggle('show', opening);
      catDdOverlay.classList.toggle('show', opening);
    });
    catDdOverlay.addEventListener('click', closeCatDd);
    this._updateCatPillLabel();

    document.getElementById('scanBtn').addEventListener('click', () => this.scan());

    // Dish search — free-text input + shortcut chips
    this._initDishSearch();

    // Address autocomplete for "Điểm xuất phát"
    this._initLocInput();

    this._initEasterEgg();

    // Sheet Trang chủ có riêng vùng cuộn (.sheet-inner-scroll) — bind
    // scroll-hide để lướt danh sách filter dài cũng làm tab bar tự ẩn,
    // giải phóng chỗ nhìn thấy nút "Quét ngay!" ở đáy sheet.
    TabNav.wireScrollHide(document.querySelector('#homeSheet .sheet-inner-scroll'));

    this._initRandomPickDrag();
    this._updateRandomPickVisibility();
    document.getElementById('rpRetryBtn').addEventListener('click', () => {
      this._closeRandomPickModal();
      setTimeout(() => this._openRandomPick(), 320);
    });
    document.getElementById('rpGoBtn').addEventListener('click', () => this._closeRandomPickModal());
    document.getElementById('randomPickModal').addEventListener('click', e => {
      if (e.target.id === 'randomPickModal') this._closeRandomPickModal();
    });

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
      State._locKind = 'user_pick';
      LocationCache.save(r.lat, r.lng, 'user_pick', r.sub || r.name);
      input.value = r.name;
      Geocoder.hide(suggest);
      showToast(`📍 ${r.sub}`);
    };

    const bias = () => ({ nearLat: State.userLat, nearLng: State.userLng });

    // Same POI-hide policy as LocationPicker.initSearch({ hidePoiOnAddress: true }):
    // when the query has a housenumber, drop POI-typed hits so the dropdown
    // and Enter land on the address, not a nearby café that shares the number.
    // Never returns empty when input was non-empty — falls back to raw
    // results if the address filter would zero out the list.
    const filterForRender = (q, results) => {
      const parsed = Geocoder.parseAddress(q);
      if (!parsed.housenumber) return results;
      const addressOnly = results.filter(r => Geocoder.isAddressType(r));
      return addressOnly.length ? addressOnly : results;
    };

    input.addEventListener('input', (e) => {
      // Skip Vietnamese IME mid-composition — see locationPicker.js comment.
      if (e.isComposing) return;
      const q = e.target.value.trim();
      if (q.length < 3) { Geocoder.hide(suggest); return; }
      reposition();
      Geocoder.showLoading(suggest);
      Geocoder.onInput('locInput', q, 450, (results) => {
        reposition();
        Geocoder.renderSuggestions(suggest, filterForRender(q, results), pick);
      }, bias());
    });
    input.addEventListener('compositionend', () => {
      const q = input.value.trim();
      if (q.length < 3) { Geocoder.hide(suggest); return; }
      reposition();
      Geocoder.showLoading(suggest);
      Geocoder.onInput('locInput', q, 450, (results) => {
        reposition();
        Geocoder.renderSuggestions(suggest, filterForRender(q, results), pick);
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
      const filtered = filterForRender(q, results);
      if (filtered.length) { pick(filtered[0]); }
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

  // Nhãn pill "Loại quán" cạnh ô "Tìm món/quán" — tóm tắt State.activeCats
  // (multi-select, giống hệt dữ liệu catDdPanel dùng): tất cả → "Tất cả
  // loại", 1 loại → tên loại đó, 2-3 loại → "n/tổng loại".
  _updateCatPillLabel() {
    const val = document.getElementById('catPillVal');
    if (!val) return;
    const total = CATEGORIES ? Object.keys(CATEGORIES).length : 4;
    const active = [...State.activeCats];
    if (active.length >= total) {
      val.textContent = I18N.t('home.catAll');
    } else if (active.length === 1) {
      val.textContent = CATEGORIES[active[0]]?.label || I18N.t('home.catAll');
    } else {
      val.textContent = I18N.t('home.catCount', { n: active.length, total });
    }
  },

  // Đặt vị trí popover "Tôi muốn ăn" NGAY TẠI #catPillBtn — ưu tiên xổ LÊN
  // (bottom neo sát mép trên của pill) vì pill nằm gần đáy sheet, gần nút
  // Quét ngay, nên khoảng trống phía trên luôn rộng hơn phía dưới. Chỉ rơi
  // xuống dưới nếu thật sự không đủ chỗ phía trên (màn rất thấp/pill bị
  // đẩy lên cao). transform-origin đổi theo hướng để hoạt ảnh scale bung
  // ra đúng từ phía pill, không phải từ giữa panel.
  //
  // Toạ độ tính theo document.body chứ KHÔNG theo window.innerWidth/Height:
  // ở màn rộng ≥560px, body có transform:translateZ(0) (xem styles.css) để
  // co lại thành cột 440px căn giữa — transform trên 1 ancestor biến nó
  // thành containing block cho MỌI con position:fixed bên trong, nên
  // left/top/bottom của panel thực chất tính từ mép body, không phải mép
  // màn hình. Tính theo window.innerWidth như code cũ khiến panel bị đẩy
  // lệch hẳn và phần vượt quá 440px bị body{overflow:hidden} cắt mất
  // (bug Vinh chụp lại 2026-09-20 — chip "Ăn vặt" bị cắt cạnh phải).
  _positionCatDropdown() {
    const btn = document.getElementById('catPillBtn');
    const panel = document.getElementById('catDdPanel');
    const r = btn.getBoundingClientRect();
    const b = document.body.getBoundingClientRect();
    const panelW = Math.min(300, b.width - 26);
    panel.style.width = `${panelW}px`;

    // Vị trí mong muốn tính theo hệ toạ độ màn hình (viewport) trước...
    let leftViewport = r.right - panelW;
    if (leftViewport < b.left + 12) leftViewport = b.left + 12;
    if (leftViewport + panelW > b.right - 12) leftViewport = b.right - panelW - 12;
    // ...rồi đổi sang hệ toạ độ của body (containing block thật) để gán
    // style — trên màn hẹp b.left≈0 nên phép trừ này không đổi gì cả.
    panel.style.left = `${leftViewport - b.left}px`;

    const originX = r.right - leftViewport;
    const spaceAbove = r.top - b.top - 12;
    const spaceBelow = b.bottom - r.bottom - 12;
    if (spaceAbove >= 160 || spaceAbove >= spaceBelow) {
      panel.style.top = 'auto';
      panel.style.bottom = `${b.bottom - r.top + 8}px`;
      panel.style.transformOrigin = `${originX}px bottom`;
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = `${r.bottom - b.top + 8}px`;
      panel.style.transformOrigin = `${originX}px top`;
    }
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
    // Analytics — fire before network so we count intent, not success
    if (typeof Analytics !== 'undefined') Analytics.track('scan', {
      radius: State.radius,
      cats: [...State.activeCats],
      srcs: [...State.activeSrcs],
      has_dish: !!(State.activeDish && State.activeDish.trim()),
      min_rating: State.minRating || 0,
    });

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
          State._locKind = 'user_pick';
          LocationCache.save(results[0].lat, results[0].lng, 'user_pick', results[0].sub || results[0].name);
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
      await this._fetchCommunityForScan();
      this._doScan();
      showToast(I18N.t('toast.fromCache'), 1800);
      return;
    }

    // ── Fresh scan ───────────────────────────────────────────────────────
    this._scanning = true;
    const ov = document.getElementById('scanOverlay');
    const txt = ov.querySelector('.scanning-txt');
    ov.style.display = 'flex';

    // Button loading state — gives instant feedback even before the map
    // overlay appears (users on small screens may have scrolled past it).
    const scanBtn = document.getElementById('scanBtn');
    const _origBtnHTML = scanBtn ? scanBtn.innerHTML : '';
    if (scanBtn) {
      scanBtn.innerHTML = '<span class="btn-spinner"></span>Đang quét…';
      scanBtn.classList.add('scanning');
    }

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
        // BUG-FIX 2026-09-16: when Gemini isn't configured, geminiP is
        // `Promise.resolve([])` above — a microtask, so its `.then(finish)`
        // fires BEFORE osmP has a chance to resolve. With total=1 (osm-only
        // mode), finished (1) >= total (1) tripped instantly and the race
        // resolved empty, silently killing every scan for users without a
        // Gemini key (banner "Không tìm thấy quán" even in Cầu Giấy).
        // Only attach `.then` to providers actually in play.
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
          if (useGemini) geminiP.then(r => finish(r, 'gemini'));
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
    await this._fetchCommunityForScan();
    // Data-source name is intentionally dev-only (devtools console) — never
    // shown in the UI. Users shouldn't need to know/care which map backend
    // answered a given scan.
    console.debug('[scan] source:', source, '· items:', items.length, '· community:', State.communityRestaurants.length);
    ov.style.display = 'none';
    this._scanning = false;

    // Restore button to original label
    if (scanBtn) {
      scanBtn.innerHTML = _origBtnHTML;
      scanBtn.classList.remove('scanning');
    }

    // ── Toast kết quả ───────────────────────────────────────────────────
    // Quota vừa hết ở lượt quét NÀY → báo ngay, bất kể OSM có tìm được gì
    // hay không (chỉ 1 lần/ngày — consumeQuotaHitFlag() tự reset ở những
    // lượt quét sau, xem gemini.js).
    const justHitQuota = typeof Gemini !== 'undefined' && Gemini.consumeQuotaHitFlag && Gemini.consumeQuotaHitFlag();
    if (justHitQuota) {
      showToast(I18N.t('toast.geminiQuotaHit'), 4000);
    } else if (items.length) {
      showToast(source === 'gemini'
        ? I18N.t('toast.foundN', { n: items.length })
        : I18N.t('toast.foundNPlain', { n: items.length }), 2200);
    } else if (State.activeSrcs.has('osm')) {
      // Nothing came back from either source. Only show "chưa có key" when
      // there truly isn't one — a key that's just on cooldown or past its
      // daily quota for today still HAS a key, so that message would be
      // misleading (isConfigured() alone can't tell these apart).
      const hasNoKey = typeof Gemini === 'undefined' || (!Gemini.userKey && !Gemini.defaultKey);
      showToast(I18N.t(hasNoKey ? 'toast.noGeminiKey' : 'toast.noResults'), hasNoKey ? 4000 : 3500);
    }

    this._doScan();
  },

  _srcOf(r) {
    if (r._community) return 'community';
    if (r._gemini) return 'osm';   // treat gemini as part of "osm" source bucket
    if (r.id >= 1e13) return 'osm';
    return 'mine';
  },

  // Adapt a raw PocketBase restaurant record into the shape the rest of
  // the app expects (numeric id, .lat/.lng, .cat, .price string, .desc,
  // .address, .image thumbnail, _community flag, _pb original for the
  // CommunityDetailModal to reopen with full context).
  _communityToAppRestaurant(pb) {
    if (!pb || !pb.id) return null;
    const cat = COMMUNITY_PB_TO_CAT[pb.category] || 'restaurant';
    const hasLoc = pb.location && (pb.location.lat !== 0 || pb.location.lon !== 0);
    // Numeric id in the 4e13 range so ResultsCtrl parseInt() works AND
    // it doesn't collide with OSM (1e13) or Gemini (2e13). Derived from
    // the PB record id so re-scans keep the same id for the same quán.
    let h = 0;
    for (let i = 0; i < pb.id.length; i++) h = ((h << 5) - h + pb.id.charCodeAt(i)) | 0;
    const numId = 4e13 + (Math.abs(h) % 1e12);
    const priceLbl = (typeof COMMUNITY_PRICE_LABEL === 'object'
      ? COMMUNITY_PRICE_LABEL[pb.price_range] : '') || '—';
    let image = null;
    try { image = Community.thumbnailUrl(pb, '400x400') || null; } catch (_) {}
    return {
      id: numId,
      name: pb.name || '',
      cat,
      price: priceLbl,
      desc: pb.description || '',
      address: pb.address || '',
      lat: hasLoc ? pb.location.lat : null,
      lng: hasLoc ? pb.location.lon : null,
      rating: 5.0,
      image,
      _community: true,
      _pb: pb, // raw record so CommunityDetailModal.open(_pb) has everything
    };
  },

  // Pull community-posted quán so scan results include them alongside
  // OSM/Gemini. Called on every scan (cache-hit path included) so a
  // freshly posted quán appears immediately. If community source is
  // switched off, clears the list — cheaper than fetching to discard.
  async _fetchCommunityForScan() {
    if (!State.activeSrcs.has('community')
        || typeof Community === 'undefined'
        || !Community.BASE_URL) {
      State.communityRestaurants = [];
      return;
    }
    try {
      const r = await Community.listRestaurants({ perPage: 100 });
      if (r.ok && Array.isArray(r.data?.items)) {
        State.communityRestaurants = r.data.items
          .map(pb => this._communityToAppRestaurant(pb))
          .filter(Boolean);
      } else {
        State.communityRestaurants = [];
      }
    } catch (e) {
      console.warn('[Community scan] failed:', e?.message || e);
      State.communityRestaurants = [];
    }
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

  // ── Random dish pick ────────────────────────────────────────────────
  // Round FAB on the home screen — pick a dish at random and scan for it
  // right away (reuses the exact dish-chip list + scan flow the manual
  // "Tìm món" search already uses). Free-draggable, snaps to whichever
  // screen corner is nearest, position remembered across visits. Can be
  // turned off entirely from Cài đặt (see ProfileCtrl._renderRandomPickToggle).
  RP_CORNER_KEY: 'nhopnhep_rp_corner',
  RP_SIDE: 16, RP_TOP: 90, RP_BOTTOM: 220,

  _updateRandomPickVisibility() {
    const fab = document.getElementById('randomPickBubble');
    if (!fab) return;
    fab.classList.toggle('hidden', !!State.profile.hideRandomPick);
  },
  _resetRandomPickBubble() {
    const fab = document.getElementById('randomPickBubble');
    document.getElementById('rpbIcon').innerHTML = svgIcon('action-dice');
    fab.classList.remove('picking');
    fab.setAttribute('aria-label', I18N.t('randomPick.cta'));
    fab.title = I18N.t('randomPick.sub');
  },
  _dishChipList() {
    // Chip giờ là icon SVG + tên (không còn emoji đứng đầu textContent như
    // trước) — đọc thẳng tên icon từ <use href="...#ic-NAME"> thay vì tách
    // chuỗi. chip.textContent giờ chỉ còn đúng phần tên món (svg không có
    // text node), khỏi cần .slice(emoji.length) nữa.
    return Array.from(document.querySelectorAll('#dishSuggest .dish-chip')).map(chip => {
      const use = chip.querySelector('use');
      const icon = use ? use.getAttribute('href').split('#ic-')[1] : '';
      return { dish: chip.dataset.dish || '', icon, name: chip.textContent.trim() };
    }).filter(d => d.dish);
  },
  async _openRandomPick() {
    if (this._rpPicking) return;
    const list = this._dishChipList();
    if (!list.length) return;
    this._rpPicking = true;
    const fab = document.getElementById('randomPickBubble');
    const rpbIcon = document.getElementById('rpbIcon');
    fab.classList.add('picking');
    let i = 0;
    const iv = setInterval(() => {
      rpbIcon.innerHTML = svgIcon(list[i % list.length].icon);
      i++;
    }, 90);
    await new Promise(r => setTimeout(r, 1200));
    clearInterval(iv);
    fab.classList.remove('picking');
    this._resetRandomPickBubble();

    const picked = list[Math.floor(Math.random() * list.length)];
    const dishInput = document.getElementById('dishInput');
    if (dishInput) dishInput.value = picked.dish;
    State.activeDish = picked.dish;

    // Keep the "picking" guard held through the scan itself (not just the
    // shuffle) — otherwise a second tap while the network scan is still in
    // flight starts a whole new shuffle for nothing, since scan() would
    // just no-op on its own _scanning guard anyway.
    try {
      // scan() itself handles "no location yet" with its own toast and
      // bails without navigating — only show the result sheet if it
      // actually landed on the results screen.
      await this.scan();
      if (document.getElementById('resultsScreen').classList.contains('hidden')) return;

      const n = State.filteredResults.length;
      const noExactMatch = State.queryUnmatched;
      document.getElementById('rpModalTitle').innerHTML =
        I18N.t('randomPick.resultTitle', { emoji: svgIcon(picked.icon), name: picked.name });
      document.getElementById('rpModalSub').textContent = n === 0
        ? I18N.t('randomPick.resultSubEmpty', { name: picked.name })
        : noExactMatch
          ? I18N.t('randomPick.resultSubFallback', { n, name: picked.name })
          : I18N.t('randomPick.resultSub', { n, name: picked.name });
      document.getElementById('randomPickModal').classList.add('show');
    } finally {
      this._rpPicking = false;
    }
  },
  _closeRandomPickModal() {
    document.getElementById('randomPickModal').classList.remove('show');
  },

  // ── FAB free-drag + corner snap ─────────────────────────────────────
  // Bounds are computed against #homeScreen, not window.innerWidth/
  // innerHeight — .screen (and this FAB) are position:fixed, and on the
  // desktop phone-frame preview (body{transform:translateZ(0)} in the
  // >=560px media query) that makes BODY their containing block, which is
  // narrower than the real browser window. Clamping against window size
  // let the FAB drag past the visible frame into the letterboxed margin,
  // where it's still technically on-screen but reads as "disappeared".
  // #homeScreen shares the same containing-block quirk, so its rect is
  // always the actual visible app area in both desktop and mobile.
  _rpScreenRect() {
    const el = document.getElementById('homeScreen');
    return el.getBoundingClientRect();
  },
  // getBoundingClientRect() is always viewport-absolute, but CSS
  // left/top on a position:fixed element resolve against its containing
  // block's own padding edge — body's own rect on the desktop preview
  // (offset from the viewport since it's centered in a wider window), the
  // viewport itself (offset 0) on a real phone. Subtract this before
  // assigning to style.left/top, or the FAB lands `body.left`/`body.top`
  // px further than intended — invisible on mobile (offset is 0 there)
  // but puts it outside the visible frame on any wider window.
  _rpContainingOffset() {
    return document.body.getBoundingClientRect();
  },
  // Always sets left/top (never right/bottom) computed straight from
  // _rpScreenRect() — CSS `bottom`/`right` on a position:fixed element
  // resolve against its containing block (viewport, or body on the
  // desktop phone-frame preview), NOT against #homeScreen's own shorter
  // box (.screen{bottom:var(--tab-h)} already excludes the tab bar from
  // ITS box, but that doesn't change what `bottom:Npx` on a sibling means)
  // — using raw `bottom` here let the FAB sit UNDER the tab bar. Deriving
  // left/top from the same rect the drag clamp already uses keeps both
  // code paths in the same coordinate space and avoids the mismatch.
  _applyRpCorner(fab, corner) {
    const screen = this._rpScreenRect();
    const offset = this._rpContainingOffset();
    const w = fab.offsetWidth || 54, h = fab.offsetHeight || 54;
    const left = corner[0] === 'l' ? screen.left + this.RP_SIDE : screen.right - this.RP_SIDE - w;
    const top = corner[1] === 't' ? screen.top + this.RP_TOP : screen.bottom - this.RP_BOTTOM - h;
    fab.style.left = (left - offset.left) + 'px';
    fab.style.top = (top - offset.top) + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  },
  _snapRpToCorner(fab) {
    const screen = this._rpScreenRect();
    const rect = fab.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const corner = (cx < screen.left + screen.width / 2 ? 'l' : 'r') + (cy < screen.top + screen.height / 2 ? 't' : 'b');
    this._applyRpCorner(fab, corner);
    try { localStorage.setItem(this.RP_CORNER_KEY, corner); } catch (_) {}
  },
  _initRandomPickDrag() {
    const fab = document.getElementById('randomPickBubble');
    let startX = 0, startY = 0, startRect = null, moved = false, pid = null;

    let savedCorner = 'rt';
    try {
      const s = localStorage.getItem(this.RP_CORNER_KEY);
      if (s && /^[lr][tb]$/.test(s)) savedCorner = s;
    } catch (_) {}
    this._applyRpCorner(fab, savedCorner);

    const onMove = (e) => {
      // No active drag (pid only gets set in pointerdown below) — a bare
      // hover/mousemove over the FAB still fires 'pointermove' per spec
      // even with no button pressed, and used to crash here reading
      // startRect.left while startRect was still null from init.
      if (pid === null || e.pointerId !== pid) return;
      const x = e.clientX, y = e.clientY;
      if (!moved && Math.hypot(x - startX, y - startY) > 6) {
        moved = true;
        fab.classList.add('dragging');
      }
      if (!moved) return;
      const screen = this._rpScreenRect();
      const offset = this._rpContainingOffset();
      const w = fab.offsetWidth, h = fab.offsetHeight;
      let left = startRect.left + (x - startX);
      let top = startRect.top + (y - startY);
      left = Math.max(screen.left + 4, Math.min(screen.right - w - 4, left));
      top = Math.max(screen.top + 4, Math.min(screen.bottom - h - 4, top));
      left -= offset.left;
      top -= offset.top;
      fab.style.left = left + 'px';
      fab.style.top = top + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    };
    const onEnd = (e) => {
      if (pid === null || e.pointerId !== pid) return;
      pid = null;
      fab.classList.remove('dragging');
      if (moved) {
        this._snapRpToCorner(fab);
        this._rpJustDragged = true;
      }
    };
    // Pointer capture on the fab itself guarantees pointermove/up/cancel
    // keep firing on it even if the finger/cursor leaves its bounds or a
    // browser quirk would otherwise drop the up event mid-drag, so the FAB
    // never gets stuck in "dragging" state.
    fab.addEventListener('pointerdown', (e) => {
      moved = false;
      pid = e.pointerId;
      startX = e.clientX; startY = e.clientY;
      startRect = fab.getBoundingClientRect();
      fab.setPointerCapture(pid);
    });
    fab.addEventListener('pointermove', onMove);
    fab.addEventListener('pointerup', onEnd);
    fab.addEventListener('pointercancel', onEnd);
    fab.addEventListener('click', () => {
      if (this._rpJustDragged) { this._rpJustDragged = false; return; }
      this._openRandomPick();
    });
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
    const src = State.lastScanSource === 'gemini' ? '✨ Nhóp Nhép'
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
        <span class="hours-badge open">${svgIcon('status-open-dot')} ${parsed.label}</span>
        <span class="hours-detail">${parsed.detail}</span>
      </div>`;
    } else if (parsed.isOpen === false) {
      return `<div class="r-hours">
        <span class="hours-badge closed">${svgIcon('status-closed-dot')} ${parsed.label}</span>
        <span class="hours-detail">${parsed.detail}</span>
      </div>`;
    } else {
      return `<div class="r-hours">
        <span class="hours-badge unknown">${svgIcon('status-hours-unclear')} ${parsed.raw}</span>
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
          <div class="es-icon">${svgIcon('action-search')}</div>
          <div class="es-msg">${I18N.t('empty.notFound', { q: `<b>${esc}</b>` })}<br>
            <span style="font-size:.82rem;opacity:.75">${I18N.t('empty.tapBelow')}</span>
          </div>
          <a class="es-gmaps-btn" href="${gmapsSearchUrl(q)}" target="_blank" rel="noopener">${I18N.t('empty.findOnMaps', { q: esc })}</a>
        </div>`;
      } else {
        grid.innerHTML = `<div class="empty-state"><div class="es-icon">${svgIcon('cat-nhahang')}</div><div class="es-msg">${I18N.t('empty.noneInCategory')}</div></div>`;
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
      const priceLabel = r.price && r.price !== '—' ? `${svgIcon('price-mid')} ${r.price}` : `${svgIcon('price-mid')} —`;
      // No real rating for OSM-sourced places — show a neutral "no data"
      // dash (matches the existing '💰 —' convention below) instead of
      // naming the data source; that stays dev-only (osm-added CSS class
      // + console.debug in scan()), never surfaced as text to users.
      const ratingLabel = isGemini ? `${r.rating.toFixed(1)} ${svgIcon('rating-star-filled')}` : (isOsm ? `${svgIcon('rating-star-filled')} —` : `${r.rating} ${svgIcon('rating-star-filled')}`);
      // Gemini invents price/rating (see prompt) — never verified against a
      // real source, so both get a visible "reference only" note right on
      // the card, not just an internal CSS hook nobody outside devtools sees.
      const refNote = isGemini ? ` <i class="r-ref-note">(${I18N.t('card.refNote')})</i>` : '';
      const hoursBadge = this._renderHoursBadge(r);
      return `<div class="r-card${sel?' selected':''}${flagCls}" data-id="${r.id}" style="animation-delay:${Math.min(i,10)*30}ms" role="button" tabindex="0" title="${I18N.t('card.tapDetail')}">
        <button class="r-check" data-id="${r.id}" title="${I18N.t('card.selectAdd')}" aria-label="${I18N.t('card.select')}" aria-pressed="${sel?'true':'false'}">${svgIcon('status-selected')}</button>
        <div class="r-cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${cat.label}</div>
        <div class="r-name">${escapeHtml(r.name)}</div>
        ${hoursBadge}
        <div class="r-price">${priceLabel}${refNote}</div>
        <div class="r-desc">${escapeHtml(r.desc)}</div>
        <div class="r-meta">
          <span class="r-rating">${ratingLabel}${refNote}</span>
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
    // Group Session cần ít nhất 2 quán để có gì đó cho bạn bè vote.
    const sessionBtn = document.getElementById('sessionCreateBtn');
    if (sessionBtn) sessionBtn.disabled = n < 2;
  },

  init() {
    document.getElementById('resultsBack').addEventListener('click', () => {
      document.getElementById('homeScreen').classList.remove('hidden');
      document.getElementById('resultsScreen').classList.add('hidden');
      // Reset trạng thái ẩn của tab bar khi rời màn results (đề phòng lướt
      // xuống ẩn rồi back về home, tab bar vẫn ở trạng thái hidden).
      document.querySelector('.tabbar')?.classList.remove('scroll-hidden');
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
    // Không bind scroll-hide cho grid — user muốn tab bar luôn hiện khi lướt
    // kết quả quét (cơ chế giống màn Trang chủ, không ẩn xuống).
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

      // Card body → open detail modal. Community results get the rich
      // community modal (photos/votes/tags), everything else gets the
      // plain DetailModal.
      const r = State.filteredResults.find(x => x.id === id)
        || (Array.isArray(State.results) ? State.results.find(x => x.id === id) : null);
      if (!r) return;
      if (r._community && r._pb) CommunityDetailModal.open(r._pb);
      else DetailModal.open(r);
    });

    document.getElementById('restaurantGrid').addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.r-card');
      if (!card || e.target.closest('.r-check')) return;
      e.preventDefault();
      const id = parseInt(card.dataset.id);
      const r = State.filteredResults.find(x => x.id === id);
      if (!r) return;
      if (r._community && r._pb) CommunityDetailModal.open(r._pb);
      else DetailModal.open(r);
    });
    document.getElementById('planBtn').addEventListener('click', () => {
      PlanCtrl._returnTo = 'results';
      PlanCtrl.buildItinerary();
      PlanCtrl.show();
    });
    document.getElementById('sessionCreateBtn').addEventListener('click', () => {
      SessionCreateModal.open();
    });
  },
};

/* ═══════════════════════════════════════════════
   GROUP SESSION — "Phiên chọn quán theo nhóm"
   Host chọn 1 nhóm quán ứng viên (từ State.selected trên màn Kết quả —
   dùng lại đúng cơ chế multi-select sẵn có, không thêm UI chọn mới),
   chia sẻ link, bạn bè vote KHÔNG CẦN tài khoản, host chốt random trong
   nhóm được vote nhiều nhất. Thuần cộng thêm — không đụng gì tới scan/
   random/lên lịch/đăng quán cộng đồng hiện có.
═══════════════════════════════════════════════ */
const SessionCreateModal = {
  init() {
    document.getElementById('sessionCreateClose').addEventListener('click', () => this.close());
    document.getElementById('sessionCreateOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'sessionCreateOverlay') this.close();
    });
    document.getElementById('sessionCreateSave').addEventListener('click', () => this._create());
  },

  // Snapshot State.selected thành candidates JSON — KHÔNG phải relation,
  // vì quán từ OSM/Gemini không có id PocketBase ổn định (xem community.js
  // createSession comment). cid chỉ cần duy nhất TRONG session này, nên
  // dùng luôn chỉ số vị trí cho đơn giản.
  open() {
    if (!Community.isLoggedIn()) { showToast(I18N.t('toast.sessionNeedLogin')); return; }
    const ids = [...State.selected];
    if (ids.length < 2) { showToast(I18N.t('toast.sessionNeedTwo')); return; }

    this._candidates = ids.map((id, i) => {
      const r = State.filteredResults.find(x => x.id === id)
        || (Array.isArray(State.results) ? State.results.find(x => x.id === id) : null);
      if (!r) return null;
      const photo = (r._community && r._pb)
        ? (Community.thumbnailUrl(r._pb, '400x400') || null)
        : (r.image || null);
      return {
        cid: 'c' + i,
        name: r.name,
        address: r.address || r.desc || '',
        lat: r.lat, lng: r.lng,
        category: r.cat,
        photo_url: photo,
        source: r._gemini ? 'gemini' : (r._community ? 'community' : (r.id >= 1e13 ? 'osm' : 'mine')),
      };
    }).filter(Boolean);

    if (this._candidates.length < 2) { showToast(I18N.t('toast.sessionNeedTwo')); return; }

    document.getElementById('sessionCreateTitle').value = '';
    document.getElementById('sessionCreateList').innerHTML = this._candidates.map(c => `
      <div class="session-cand-row">
        <span class="session-cand-icon">${(CATEGORIES[c.category] && CATEGORIES[c.category].icon) || svgIcon('cat-nhahang')}</span>
        <span class="session-cand-name">${escapeHtml(c.name)}</span>
      </div>
    `).join('');
    document.getElementById('sessionCreateOverlay').classList.add('show');
  },

  close() {
    document.getElementById('sessionCreateOverlay').classList.remove('show');
  },

  async _create() {
    const btn = document.getElementById('sessionCreateSave');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = I18N.t('session.creating');
    const title = document.getElementById('sessionCreateTitle').value.trim();
    const r = await Community.createSession({ title, candidates: this._candidates });
    btn.disabled = false; btn.textContent = original;
    if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
    if (typeof Analytics !== 'undefined') Analytics.track('session_created', { n: this._candidates.length });
    this.close();
    SessionVoteModal.openAsHost(r.data);
  },
};

const SessionVoteModal = {
  _session: null,
  _counts: {},
  _myVotes: new Set(),
  _isHost: false,
  _pollTimer: null,
  _pollBusy: false,
  _failCount: 0,
  _lastVotesSig: null,
  _lastUpdated: null,

  init() {
    document.getElementById('sessionVoteClose').addEventListener('click', () => this.close());
    document.getElementById('sessionVoteOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'sessionVoteOverlay') this.close();
    });
    document.getElementById('sessionInviteCopy').addEventListener('click', () => this._copyInviteLink());
    document.getElementById('sessionVoteCloseSession').addEventListener('click', () => this._closeAndRandom());
    document.getElementById('sessionVoteList').addEventListener('click', (e) => {
      const row = e.target.closest('.session-vote-row');
      if (!row || this._session?.status !== 'open') return;
      this._onVoteTap(row.dataset.cid);
    });
  },

  // Host vừa tạo xong — record đầy đủ đã có sẵn, không cần fetch lại.
  openAsHost(sessionRecord) {
    this._open(sessionRecord, true);
  },

  // Từ link mời (?join=<id>) — participant hoặc host mở lại từ máy khác.
  async openFromInvite(id) {
    if (!id) return;
    const r = await Community.getSession(id);
    if (!r.ok || !r.data) { showToast(I18N.t('toast.sessionNotFound')); return; }
    const isHost = Community.isLoggedIn() && r.data.host === Community.currentUser.id;
    this._open(r.data, isHost);
  },

  _open(sessionRecord, isHost) {
    this._session = sessionRecord;
    this._isHost = isHost;
    this._counts = {};
    this._myVotes = new Set();
    this._lastVotesSig = null;
    this._lastUpdated = null;
    this._failCount = 0;

    document.getElementById('sessionVoteTitle').innerHTML = sessionRecord.title
      ? `${svgIcon('session-create')} ${escapeHtml(sessionRecord.title)}` : I18N.t('session.defaultTitle');
    document.getElementById('sessionInviteLink').value = `${location.origin}/?join=${sessionRecord.id}`;
    document.getElementById('sessionReconnectBanner').classList.add('hidden');
    document.getElementById('sessionVoteOverlay').classList.add('show');

    // Tên quán đã có sẵn trong session.candidates (snapshot) — render NGAY,
    // không đợi network. Vote count thật (ban đầu luôn là 0 nếu vừa tạo,
    // hoặc cần fetch nếu mở từ link) tới trong lượt poll đầu tiên ngay sau
    // đây — tránh gọi _refresh() 2 lần liền (1 lần ở đây + 1 lần trong tick
    // đầu của _startPolling()).
    this._render();
    this._startPolling();
  },

  close() {
    this._stopPolling();
    document.getElementById('sessionVoteOverlay').classList.remove('show');
  },

  async _copyInviteLink() {
    const url = document.getElementById('sessionInviteLink').value;
    try {
      await navigator.clipboard.writeText(url);
      showToast(I18N.t('toast.linkCopied'));
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); showToast(I18N.t('toast.linkCopied')); }
      catch (_) { showToast(I18N.t('toast.linkCopyFail')); }
      document.body.removeChild(ta);
    }
  },

  async _onVoteTap(cid) {
    // Optimistic UI — cập nhật ngay tại chỗ, không đợi round-trip 3s poll.
    // Poll kế tiếp sẽ tự sửa nếu có lệch (race với người khác vote cùng lúc).
    const wasVoted = this._myVotes.has(cid);
    if (wasVoted) { this._myVotes.delete(cid); this._counts[cid] = Math.max(0, (this._counts[cid] || 1) - 1); }
    else { this._myVotes.add(cid); this._counts[cid] = (this._counts[cid] || 0) + 1; }
    this._render();
    const r = await Community.castVote(this._session.id, cid);
    if (!r.ok) {
      // Rollback nếu server từ chối (session đã đóng giữa chừng, v.v.)
      if (wasVoted) { this._myVotes.add(cid); this._counts[cid] = (this._counts[cid] || 0) + 1; }
      else { this._myVotes.delete(cid); this._counts[cid] = Math.max(0, (this._counts[cid] || 1) - 1); }
      this._render();
      showToast(`⚠️ ${r.error}`);
    }
  },

  async _closeAndRandom() {
    const candidates = this._session.candidates || [];
    if (!candidates.length) return;
    let maxCount = 0;
    for (const c of candidates) maxCount = Math.max(maxCount, this._counts[c.cid] || 0);
    // Chưa ai vote gì cả → random đều trong TẤT CẢ candidate, không phải
    // random trong "top 0 phiếu" (sẽ luôn khớp mọi candidate, vô nghĩa).
    const pool = maxCount > 0
      ? candidates.filter(c => (this._counts[c.cid] || 0) === maxCount)
      : candidates;
    const winner = pool[Math.floor(Math.random() * pool.length)];

    const btn = document.getElementById('sessionVoteCloseSession');
    btn.disabled = true;
    const r = await Community.closeSession(this._session.id, winner.cid);
    btn.disabled = false;
    if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
    if (typeof Analytics !== 'undefined') Analytics.track('session_closed', { n: candidates.length });
    await this._refresh();
  },

  // ── Poll: gọi mỗi ~3s trong lúc modal mở. Fetch session (cheap, để bắt
  // được lúc host chốt — KHÔNG sinh vote record mới nên signature phiếu
  // bầu không đổi) + signature phiếu bầu (cheap). Chỉ khi 1 trong 2 đổi
  // mới làm tally đầy đủ (nặng hơn). Backoff về 9s sau 3 lần lỗi liên tiếp,
  // trở lại 3s ngay khi 1 lần poll thành công.
  async _pollTick() {
    if (this._pollBusy || document.hidden || !this._session) return;
    this._pollBusy = true;
    const [sessionR, sig] = await Promise.all([
      Community.getSession(this._session.id),
      Community.sessionSignature(this._session.id),
    ]);
    this._pollBusy = false;

    if (!sessionR.ok || sig === null) {
      this._failCount++;
      if (this._failCount >= 3) {
        document.getElementById('sessionReconnectBanner').classList.remove('hidden');
        this._scheduleNext(9000);
      }
      return;
    }
    this._failCount = 0;
    document.getElementById('sessionReconnectBanner').classList.add('hidden');
    this._scheduleNext(3000);

    const changed = sessionR.data.updated !== this._lastUpdated || sig.sig !== this._lastVotesSig;
    this._session = sessionR.data;
    this._lastUpdated = sessionR.data.updated;
    this._lastVotesSig = sig.sig;
    if (changed) await this._refresh(true);
  },

  _scheduleNext(ms) {
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => this._pollTick(), ms);
  },

  _startPolling() {
    this._stopPolling();
    this._pollTick();
    this._pollTimer = setInterval(() => this._pollTick(), 3000);
    this._visHandler = () => { if (!document.hidden) this._pollTick(); };
    document.addEventListener('visibilitychange', this._visHandler);
  },

  _stopPolling() {
    clearInterval(this._pollTimer);
    if (this._visHandler) document.removeEventListener('visibilitychange', this._visHandler);
  },

  // Tally đầy đủ + vote của chính mình — chỉ gọi khi cần (lần đầu mở, hoặc
  // signature/updated vừa đổi), không phải mỗi tick.
  async _refresh(skipSessionFetch) {
    if (!skipSessionFetch) {
      const r = await Community.getSession(this._session.id);
      if (r.ok) this._session = r.data;
    }
    const [countsR, myVotes] = await Promise.all([
      Community.getSessionResults(this._session.id),
      Community.myVotesInSession(this._session.id),
    ]);
    if (countsR.ok) this._counts = countsR.data;
    this._myVotes = myVotes;
    this._render();
  },

  _render() {
    const s = this._session;
    if (!s) return;
    const isClosed = s.status === 'closed';
    const isExpired = !isClosed && s.expires_at && new Date(s.expires_at).getTime() < Date.now();

    document.getElementById('sessionExpiredBanner').classList.toggle('hidden', !isExpired);
    document.getElementById('sessionVoteSub').textContent = isClosed
      ? I18N.t('session.subClosed')
      : I18N.t('session.subOpen', { n: (s.candidates || []).length });

    const list = document.getElementById('sessionVoteList');
    list.innerHTML = (s.candidates || []).map(c => {
      const voted = this._myVotes.has(c.cid);
      const isWinner = isClosed && s.winner_cid === c.cid;
      const count = this._counts[c.cid] || 0;
      const catIcon = (CATEGORIES[c.category] && CATEGORIES[c.category].icon) || svgIcon('cat-nhahang');
      return `<div class="session-vote-row${voted ? ' voted' : ''}${isWinner ? ' winner' : ''}" data-cid="${c.cid}">
        <span class="session-vote-icon">${isWinner ? svgIcon('social-trophy') : catIcon}</span>
        <span class="session-vote-name">${escapeHtml(c.name)}</span>
        <span class="session-vote-count">${count}</span>
        <span class="session-vote-check">${svgIcon('status-confirmed')}</span>
      </div>`;
    }).join('');

    const winnerBanner = document.getElementById('sessionWinnerBanner');
    if (isClosed) {
      const winner = (s.candidates || []).find(c => c.cid === s.winner_cid);
      document.getElementById('sessionWinnerName').textContent = winner ? winner.name : '';
      winnerBanner.classList.remove('hidden');
    } else {
      winnerBanner.classList.add('hidden');
    }

    const closeBtn = document.getElementById('sessionVoteCloseSession');
    closeBtn.classList.toggle('hidden', !this._isHost || isClosed);
    closeBtn.disabled = isExpired;
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
  // origin (tuỳ chọn): điểm xuất phát để sắp thứ tự các điểm dừng. Mặc định
  // là vị trí hiện tại, NHƯNG lộ trình đã lưu truyền vào điểm xuất phát của
  // chính nó — người dùng lên lịch cho Đà Nẵng từ lúc còn ở Hà Nội thì phải
  // tính đường trong Đà Nẵng, chứ không phải từ chỗ đang đứng.
  buildItinerary(customStops, origin) {
    const from = (origin && origin.lat != null && origin.lng != null)
      ? origin
      : { lat: State.userLat, lng: State.userLng };
    const stops = customStops
      ? customStops.map(r => ({ ...r, _dist: haversine(from.lat, from.lng, r.lat, r.lng) }))
      : allRestaurants()
          .filter(r => State.selected.has(r.id))
          .map(r => ({ ...r, _dist: haversine(from.lat, from.lng, r.lat, r.lng) }));

    let current = { lat: from.lat, lng: from.lng };
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
    if (typeof Analytics !== 'undefined') Analytics.track('plan_built', {
      stops: State.itinerary.length,
      // Whether user was assembling a fresh plan or replaying a saved
      // one — different intent, want to be able to split in the dashboard.
      replay: !!customStops,
    });
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

  // ── Lưu lộ trình để đi sau ──────────────────────────────────────────
  // Khác "Đi lại" ở trên: lộ trình lưu mang theo ĐIỂM XUẤT PHÁT của chính
  // nó, nên mở lại lúc còn ở nhà vẫn dựng đúng đường tại nơi sắp tới —
  // không đòi GPS, không tính đường từ chỗ đang đứng.
  _promptTripName(defaultValue) {
    return new Promise(resolve => {
      const overlay = document.getElementById('tripNameOverlay');
      const input   = document.getElementById('tripNameInput');
      const confirm = document.getElementById('tripNameConfirm');
      const cancel  = document.getElementById('tripNameCancel');
      if (!overlay) { resolve(defaultValue); return; }

      input.value = defaultValue;
      overlay.classList.add('show');
      input.focus(); input.select();

      const done = (val) => {
        overlay.classList.remove('show');
        confirm.removeEventListener('click', onConfirm);
        cancel.removeEventListener('click', onCancel);
        input.removeEventListener('keydown', onKey);
        overlay.removeEventListener('click', onBackdrop);
        resolve(val);
      };
      const onConfirm  = () => done(input.value.trim());
      const onCancel   = () => done('');
      const onKey      = (e) => { if (e.key === 'Enter') done(input.value.trim()); if (e.key === 'Escape') done(''); };
      const onBackdrop = (e) => { if (e.target === overlay) done(''); };

      confirm.addEventListener('click', onConfirm);
      cancel.addEventListener('click', onCancel);
      input.addEventListener('keydown', onKey);
      overlay.addEventListener('click', onBackdrop);
    });
  },

  async saveCurrentTrip() {
    if (!State.itinerary.length) { showToast(I18N.t('savedTrip.nothingToSave')); return; }
    const suggested = I18N.t('savedTrip.defaultName', {
      place: (document.getElementById('locInput')?.value || '').trim().split(',')[0] || I18N.t('savedTrip.unnamedPlace'),
    });
    const name = (await this._promptTripName(suggested)).trim();
    if (!name) return;

    State.savedTrips = State.savedTrips || [];
    State.savedTrips.unshift({
      id: Date.now(),
      name: name.slice(0, 60),
      at: new Date().toISOString(),
      // Chụp lại điểm xuất phát ĐANG dùng, kèm nhãn người dùng đã gõ, để
      // sau này còn biết lộ trình này thuộc vùng nào.
      origin: {
        lat: State.userLat, lng: State.userLng,
        label: (document.getElementById('locInput')?.value || '').trim().slice(0, 80),
      },
      stops: State.itinerary.map(s => ({
        id: s.id, name: s.name, cat: s.cat, price: s.price,
        address: s.address || null, lat: s.lat, lng: s.lng,
      })),
    });
    Storage.save();
    const btn = document.getElementById('planSaveBtn');
    if (btn) { btn.classList.add('saved'); setTimeout(() => btn.classList.remove('saved'), 1200); }
    showToast(I18N.t('savedTrip.saved', { name }));
    if (typeof Analytics !== 'undefined') Analytics.track('trip_saved', { stops: State.itinerary.length });
  },

  openSavedTrip(trip) {
    this._returnTo = 'profile';
    // Dùng điểm xuất phát của lộ trình. Nếu người dùng ĐÃ tới nơi (GPS bật
    // và ở trong bán kính 30km) thì lấy vị trí thật — lúc đó đường đi từ
    // chỗ đang đứng mới đúng thứ mình cần.
    // haversine() trả về MÉT (R = 6371000), không phải km — hằng số đặt tên
    // theo đơn vị để khỏi lặp lại nhầm lẫn này.
    const ARRIVED_RADIUS_M = 30000; // 30km: coi như đã tới vùng của lộ trình
    const o = trip.origin || {};
    let from = (o.lat != null && o.lng != null) ? o : null;
    if (State.userLat != null && State.userLng != null) {
      if (!from || haversine(State.userLat, State.userLng, from.lat, from.lng) < ARRIVED_RADIUS_M) {
        from = { lat: State.userLat, lng: State.userLng };
      }
    }
    this.buildItinerary(trip.stops.map(s => ({ ...s })), from);
    this.show();
  },

  _renderSummary() {
    const totalTravel = State.itinerary.reduce((s,x) => s+x.travelMin, 0);
    const totalDwell  = State.itinerary.reduce((s,x) => s+x.dwell, 0);
    const totalDist   = State.itinerary.reduce((s,x) => s+x._legDist, 0);
    const endTime     = State.itinerary.length ? State.itinerary[State.itinerary.length-1].departureClock : new Date();
    const startTime   = State.itinerary.length ? addMinutes(State.itinerary[0].arrivalClock, -State.itinerary[0].travelMin) : new Date();

    document.getElementById('planSummary').innerHTML = `
      <div class="sum-chip"><span class="sci">${svgIcon('route-stop-count')}</span>${I18N.t('plan.stops', { n: State.itinerary.length })}</div>
      <div class="sum-chip"><span class="sci">${svgIcon('route-time-window')}</span>${fmtClock(startTime)} → ${fmtClock(endTime)}</div>
      <div class="sum-chip"><span class="sci">${svgIcon('route-duration')}</span>${fmtTime(totalTravel+totalDwell)}</div>
      <div class="sum-chip"><span class="sci">${svgIcon('action-gps')}</span>${fmtDist(totalDist)}</div>
      <div class="sum-chip"><span class="sci">${svgIcon('route-scooter')}</span>${I18N.t('plan.motorbike')}</div>
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
      <div class="tl-spine"><div class="tl-dot" style="background:#F8DFD3;border-color:#B92626;font-size:.85rem">${svgIcon('action-gps')}</div><div class="tl-line"></div></div>
      <div class="tl-content"><div class="tl-start">${I18N.t('plan.depart', { time: fmtClock(addMinutes(State.itinerary[0].arrivalClock, -State.itinerary[0].travelMin)) })}</div></div>
    </div>`;

    State.itinerary.forEach((stop, i) => {
      const cat = CATEGORIES[stop.cat];
      const isLast = i === State.itinerary.length-1;
      const hoursWarn = this._renderHoursWarning(stop);

      html += `<div class="tl-item">
        <div class="tl-spine"><div class="tl-dot" style="font-size:.85rem">${svgIcon('route-scooter')}</div><div class="tl-line"></div></div>
        <div class="tl-content">
          <div class="tl-travel">
            <span class="tl-travel-icon">${svgIcon('route-scooter')}</span>
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
        <div class="tl-spine"><div class="tl-dot" style="background:#FFF3B0;border-color:#B98A00;font-size:.85rem">${svgIcon('route-flag-finish')}</div></div>
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

  // Draws a route through `pts` ([lat,lng][], in order) on State.planMap:
  // an immediate dashed straight-line fallback so the map is never empty,
  // then swaps in the real OSRM road route once it resolves (kept on
  // failure — better an approximate line than none). Shared by the
  // initial preview draw, nav-start, each leg-advance, and reroute-on-
  // deviation, so all of them look and behave the same way. Returns a
  // Promise of the resolved route's points ([lat,lng][]) or null.
  _routeLayer: null,
  _drawRoute(pts) {
    if (this._routeLayer) { try { this._routeLayer.remove(); } catch(_){} }
    this._routeLayer = L.polyline(pts, {
      color: '#B92626', weight: 3, opacity: .55, dashArray: '7,5',
    }).addTo(State.planMap);

    const osrmCoords = pts.map(([la, lo]) => `${lo},${la}`).join(';');
    return fetch(`https://router.project-osrm.org/route/v1/driving/${osrmCoords}?overview=full&geometries=geojson`)
      .then(r => r.json())
      .then(data => {
        const geom = data.routes?.[0]?.geometry;
        if (!geom) return null;
        if (this._routeLayer) { try { this._routeLayer.remove(); } catch(_){} }
        const routePts = geom.coordinates.map(([lo, la]) => [la, lo]);
        this._routeLayer = L.polyline(routePts, {
          color: '#B92626', weight: 4.5, opacity: .9, lineJoin: 'round', lineCap: 'round',
        }).addTo(State.planMap);
        return routePts;
      })
      .catch(() => null); // keep the dashed fallback on error
  },

  _initPlanMap() {
    if (State.planMap) { try { State.planMap.remove(); } catch(_){} State.planMap = null; }
    const stops = State.itinerary;
    if (!stops.length) return;

    const allPts = [[State.userLat, State.userLng], ...stops.map(s => [s.lat, s.lng])];
    const bounds = L.latLngBounds(allPts);

    // Interactive map — user can pan/zoom to inspect the route.
    // rotate:true (leaflet-rotate plugin, loaded in index.html) enables
    // heading-up nav mode via setBearing() — see _onLiveFix(). Markers
    // default to rotateWithView:false in that plugin, so stop pins/live
    // dot stay screen-upright automatically as the map rotates; nothing
    // extra needed here for that.
    State.planMap = L.map('planMap', {
      zoomControl: false, attributionControl: false,
      dragging: true, scrollWheelZoom: true, touchZoom: true, doubleClickZoom: true,
      rotate: true, rotateControl: false, touchRotate: true, bearing: 0,
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

    // Draw straight-line fallback immediately so map isn't empty while
    // routing loads, then swap in the real road route once OSRM answers
    // (see _drawRoute — shared with nav-time reroute/leg-advance so the
    // "dashed now, solid once loaded" behavior stays consistent everywhere).
    this._routeLayer = null;
    this._drawRoute(allPts);

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
      <button class="pmap-btn pmap-locate" id="pmapLocate" title="${I18N.t('pmap.myLocation')}">${svgIcon('action-gps')}</button>
      <button class="pmap-btn pmap-fs" id="pmapFs" title="${I18N.t('pmap.fullscreen')}">${svgIcon('action-fullscreen')}</button>
    `;
    wrap.appendChild(ctrl);
    document.getElementById('pmapZoomIn').addEventListener('click', () => State.planMap.zoomIn());
    document.getElementById('pmapZoomOut').addEventListener('click', () => State.planMap.zoomOut());
    document.getElementById('pmapFit').addEventListener('click', () => State.planMap.fitBounds(bounds.pad(0.25)));
    document.getElementById('pmapLocate').addEventListener('click', () => PlanCtrl._centerOnMe());
    document.getElementById('pmapFs').addEventListener('click', () => PlanCtrl._toggleFullscreen());

    // Single "Bắt đầu"/"Đang đi"/"Tạm dừng" button — only visible in
    // fullscreen. One control, 3 states, cycling: idle -> tap starts ->
    // tap pauses -> tap resumes -> ... -> long-press ends -> back to
    // idle. No separate pause button (see _wireNavButtons/_renderNavButtonState).
    const oldNavControls = wrap.querySelector('.pmap-nav-controls');
    if (oldNavControls) oldNavControls.remove();
    const navControls = document.createElement('div');
    navControls.className = 'pmap-nav-controls';
    navControls.innerHTML = `
      <button class="pmap-start-btn" id="pmapStart" type="button" aria-label="${I18N.t('nav.startAria')}">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true"></svg>
        <span></span>
      </button>
    `;
    wrap.appendChild(navControls);
    this._navActive = false;
    this._navPaused = false;
    this._wireNavButtons();
  },

  // The button's icon swaps with its state (nav arrow while idle/moving,
  // a play triangle once paused, to hint "tap to resume"). Path data for
  // each, injected into the <svg> created above.
  NAV_ICON_ARROW: '<path d="M12 3.2c-.5 0-1 .3-1.2.85L4 20.2c-.35.85.55 1.65 1.35 1.2L12 17.7l6.65 3.7c.8.45 1.7-.35 1.35-1.2L13.2 4.05C13 3.5 12.5 3.2 12 3.2Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  NAV_ICON_PLAY: '<path d="M8 5v14l11-7z" fill="currentColor"/>',

  init() {
    document.getElementById('planSaveBtn')?.addEventListener('click', () => this.saveCurrentTrip());
    document.getElementById('planBack').addEventListener('click', () => {
      this._stopLiveTracking();
      document.getElementById('planMapWrap')?.classList.remove('fullscreen');
      document.getElementById('planScreen').classList.add('hidden');
      // Reset scroll-hide state khi rời plan (xem chú thích ở resultsBack).
      document.querySelector('.tabbar')?.classList.remove('scroll-hidden');
      if (this._returnTo === 'profile') {
        document.getElementById('profileScreen').classList.remove('hidden');
        ProfileCtrl.render();
      } else if (this._returnTo === 'community') {
        // Entered from a check-in's "Đi tới" → back returns to Cộng đồng.
        // Added 2026-09-22 alongside CheckinViewerCtrl integration.
        document.getElementById('communityScreen').classList.remove('hidden');
        CommunityCtrl.render();
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
    // Lướt timeline → tab bar tự ẩn để không che nội dung cuối lộ trình.
    TabNav.wireScrollHide(document.getElementById('timeline'));
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
      btn.innerHTML = isFs ? svgIcon('action-close') : svgIcon('action-fullscreen');
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

  // ── Turn-by-turn nav state (all PlanCtrl-scoped, like _watchId/_liveMarker
  //    already were — reset fresh on every _initPlanMap rebuild) ──────────
  _navActive: false,       // trip in progress (button shows green "Đang đi")
  _navPaused: false,       // tracking frozen mid-trip, trip still "active"
  _navLegIndex: 0,         // State.itinerary[navLegIndex] = stop we're heading to now
  _navRoutePoints: [],     // [lat,lng][] remaining road ahead for the CURRENT leg — trimmed as the user walks it
  _navHeading: null,       // smoothed bearing (deg, 0=north) — drives map rotation
  _navOffRoute: false,     // true while a reroute fetch is in flight
  _offRouteStreak: 0,      // consecutive off-threshold fixes (debounce GPS jitter before declaring off-route)
  OFF_ROUTE_M: 40,         // meters from the route line before it's "wrong direction"
  OFF_ROUTE_STREAK: 2,     // how many consecutive bad fixes before triggering reroute
  ARRIVE_M: 30,            // meters from a stop to count as "arrived"
  HOLD_END_MS: 650,        // long-press duration to end the trip
  _suppressNextClick: false, // set right before _endNav()'s DOM rebuild so the trailing click (on whichever button ends up at that spot) doesn't re-trigger _startNav()

  // Google-Maps-style "Bắt đầu": start live GPS, zoom to user, fetch the
  // real route for the current leg, and switch the button into "Đang đi"
  // (navigating) state. From there the SAME button cycles: tap ->
  // pause, tap -> resume, ... ; long-press -> end (_endNav). Recentering
  // is the separate 📍 pmapLocate button, not this one.
  async _startNav() {
    if (!State.planMap) return;
    const wrap = document.getElementById('planMapWrap');
    if (wrap && !wrap.classList.contains('fullscreen')) this._toggleFullscreen();
    this._startLiveTracking();

    if (State.userLat == null || State.userLng == null) {
      showToast(I18N.t('toast.fetchingGps'));
      return;
    }

    this._navActive = true;
    this._navPaused = false;
    this._navLegIndex = 0;
    this._navHeading = null;
    this._navOffRoute = false;
    this._offRouteStreak = 0;
    this._renderNavButtonState();

    State.planMap.setView([State.userLat, State.userLng], 17);
    showToast(I18N.t('toast.trackingRealtime'));
    await this._buildLegRoute();
  },

  // Fetches the road route from the CURRENT position through every stop
  // from _navLegIndex onward, and stores the point array for off-route/
  // trim math (_onLiveFix). Called at nav-start and again after each
  // arrival (advancing to the next leg).
  async _buildLegRoute() {
    const stops = State.itinerary.slice(this._navLegIndex);
    if (!stops.length || State.userLat == null || State.userLng == null) return;
    const pts = [[State.userLat, State.userLng], ...stops.map(s => [s.lat, s.lng])];
    const routePts = await this._drawRoute(pts);
    this._navRoutePoints = routePts || pts;
  },

  // Fully stops the GPS watch (not just a flag _onLiveFix checks) — the
  // live dot/accuracy circle genuinely freeze in place, not just the nav
  // math (rotation/reroute/trim). _liveMarker/_liveCircle are left as-is
  // so the dot stays visible right where it was.
  _pauseNav() {
    if (!this._navActive) return;
    this._navPaused = true;
    if (this._watchId != null) {
      try { navigator.geolocation.clearWatch(this._watchId); } catch (_) {}
      this._watchId = null;
    }
    this._renderNavButtonState();
    showToast(I18N.t('nav.paused'));
  },

  _resumeNav() {
    if (!this._navActive) return;
    this._navPaused = false;
    this._startLiveTracking(); // restarts watchPosition where _pauseNav stopped it
    this._renderNavButtonState();
    showToast(I18N.t('nav.resumed'));
  },

  // Long-press on the "Đang đi" button, or the destination reached —
  // fully stops the trip and rebuilds the plan map back to its pristine
  // pre-nav state (also exits fullscreen, matching how entering fullscreen
  // auto-starts tracking).
  _endNav(opts = {}) {
    this._navActive = false;
    this._navPaused = false;
    this._navOffRoute = false;
    this._navRoutePoints = [];
    this._navHeading = null;
    this._offRouteStreak = 0;
    this._showOffRouteBanner(false);
    const wrap = document.getElementById('planMapWrap');
    if (wrap && wrap.classList.contains('fullscreen')) this._toggleFullscreen();
    this._initPlanMap(); // fresh map: resets bearing, route, buttons, markers
    if (!opts.silent) showToast(I18N.t('nav.ended'));
  },

  // 3 states, one button: idle "Bắt đầu" (red) -> navigating "Đang đi"
  // (green, nav-arrow) -> paused "Tạm dừng" (amber, play icon, hints
  // "tap to resume") -> ... cycling between navigating/paused on each
  // tap -> long-press ends, back to idle. No separate pause button.
  _renderNavButtonState() {
    const btn = document.getElementById('pmapStart');
    if (!btn) return;
    btn.classList.toggle('navigating', this._navActive && !this._navPaused);
    btn.classList.toggle('paused', this._navActive && this._navPaused);
    const label = btn.querySelector('span');
    const icon = btn.querySelector('svg');
    let text, iconSvg, aria;
    if (!this._navActive) {
      text = I18N.t('nav.start'); iconSvg = this.NAV_ICON_ARROW; aria = I18N.t('nav.startAria');
    } else if (this._navPaused) {
      text = I18N.t('nav.pausedLabel'); iconSvg = this.NAV_ICON_PLAY; aria = I18N.t('nav.resumeAria');
    } else {
      text = I18N.t('nav.navigating'); iconSvg = this.NAV_ICON_ARROW; aria = I18N.t('nav.pauseAria');
    }
    if (label) label.textContent = text;
    if (icon) icon.innerHTML = iconSvg;
    btn.setAttribute('aria-label', aria);
  },

  // Tap: idle -> start; navigating -> pause; paused -> resume. Long-press
  // (HOLD_END_MS), only while active (paused or not) -> end the trip.
  // Pointer events (not click) so touch + mouse share one code path and
  // we can time the hold.
  _wireNavButtons() {
    const startBtn = document.getElementById('pmapStart');
    if (!startBtn) return;
    this._renderNavButtonState();

    let holdTimer = null;
    const cancelHold = () => {
      clearTimeout(holdTimer); holdTimer = null;
      startBtn.classList.remove('holding');
    };
    startBtn.style.setProperty('--hold-ms', `${this.HOLD_END_MS}ms`);
    startBtn.addEventListener('pointerdown', () => {
      if (!this._navActive) return; // idle "Bắt đầu" has no long-press behavior
      startBtn.classList.add('holding');
      holdTimer = setTimeout(() => {
        cancelHold();
        // _endNav() rebuilds the whole map (_initPlanMap), which replaces
        // THIS button with a fresh element+listeners while the finger may
        // still be down — a per-closure "longPressed" flag would live on
        // the old (now-detached) button and never see the trailing click
        // that lands on the new one. A PlanCtrl-level flag survives the
        // rebuild regardless of which button instance the click actually
        // targets. (Caught live-testing: a synthetic long-press + trailing
        // click immediately re-triggered _startNav() without this.)
        this._suppressNextClick = true;
        this._endNav();
        setTimeout(() => { this._suppressNextClick = false; }, 400);
      }, this.HOLD_END_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt =>
      startBtn.addEventListener(evt, cancelHold)
    );
    startBtn.addEventListener('click', () => {
      if (this._suppressNextClick) { this._suppressNextClick = false; return; }
      if (!this._navActive) this._startNav();
      else if (this._navPaused) this._resumeNav();
      else this._pauseNav();
    });
  },

  _showOffRouteBanner(show) {
    const wrap = document.getElementById('planMapWrap');
    let el = document.getElementById('pmapOffRoute');
    if (show) {
      if (!el && wrap) {
        el = document.createElement('div');
        el.id = 'pmapOffRoute';
        el.className = 'pmap-offroute-banner';
        el.innerHTML = `<span class="pmap-offroute-icon">${svgIcon('route-reroute')}</span><span>${I18N.t('nav.offRoute')}</span>`;
        wrap.appendChild(el);
      }
    } else if (el) {
      el.remove();
    }
  },

  // Called on every live fix while navigating: if the user has drifted
  // more than OFF_ROUTE_M from _navRoutePoints for OFF_ROUTE_STREAK
  // fixes in a row, recompute the route from here to the remaining stops
  // (dashed immediately via _drawRoute, replaced by the real road route
  // once OSRM answers — same convention as every other route draw).
  async _reroute() {
    if (this._navOffRoute) return;
    this._navOffRoute = true;
    this._showOffRouteBanner(true);
    await this._buildLegRoute();
    this._navOffRoute = false;
    this._offRouteStreak = 0;
    this._showOffRouteBanner(false);
  },

  // Advances to the next stop once within ARRIVE_M of the current target;
  // ends the trip (with a completion toast) once the last stop is reached.
  _checkArrival() {
    const stops = State.itinerary;
    const target = stops[this._navLegIndex];
    if (!target || State.userLat == null) return;
    const d = this._haversineKm(State.userLat, State.userLng, target.lat, target.lng) * 1000;
    if (d > this.ARRIVE_M) return;
    this._navLegIndex++;
    if (this._navLegIndex >= stops.length) {
      showToast(I18N.t('nav.tripComplete'));
      this._endNav({ silent: true });
    } else {
      showToast(I18N.t('nav.arrivedAt', { name: target.name }));
      this._buildLegRoute();
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

  // Forward azimuth in degrees (0=north, 90=east) from point 1 to point 2.
  _bearingDeg(lat1, lng1, lat2, lng2) {
    const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
    const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lng2 - lng1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  },

  // Exponential smoothing across the shortest angular path (so 350°→10°
  // interpolates through 360°/0°, not the long way through 180°) — keeps
  // the map rotation from visibly snapping/jittering between fixes.
  _smoothHeading(newHeading) {
    if (this._navHeading == null) return newHeading;
    const diff = ((newHeading - this._navHeading + 540) % 360) - 180;
    return (this._navHeading + diff * 0.35 + 360) % 360;
  },

  // Small local equirectangular projection (meters, flat-earth) — plenty
  // accurate at the scale of one route leg, much cheaper than doing
  // real great-circle math per segment.
  _toXY(lat, lng, refLat) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    return { x: R * toRad(lng) * Math.cos(toRad(refLat)), y: R * toRad(lat) };
  },

  // Perpendicular distance (meters) from (lat,lng) to the closest point
  // on polyline `pts`, plus which segment/fraction it falls on — used
  // both for off-route detection and for trimming the drawn line.
  _closestPointOnRoute(lat, lng, pts) {
    if (!pts || pts.length < 2) return null;
    const p = this._toXY(lat, lng, lat);
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = this._toXY(pts[i][0], pts[i][1], lat);
      const b = this._toXY(pts[i + 1][0], pts[i + 1][1], lat);
      const abx = b.x - a.x, aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = a.x + abx * t, cy = a.y + aby * t;
      const distM = Math.hypot(p.x - cx, p.y - cy);
      if (!best || distM < best.distM) best = { distM, segIndex: i, t };
    }
    return best;
  },

  // Cuts everything BEHIND the user off the route array, so what's drawn
  // is only the path still ahead — the projected point itself becomes
  // the new start, followed by the untouched remainder of the polyline.
  _trimRouteAhead(pts, closest) {
    const { segIndex, t } = closest;
    const a = pts[segIndex], b = pts[segIndex + 1];
    const projected = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return [projected, ...pts.slice(segIndex + 1)];
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
    const prevLat = State.userLat, prevLng = State.userLng;
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

    // Everything below is nav-specific (heading/rotation, off-route/
    // reroute, trimming, arrival) — only while a trip is active and not
    // paused.
    if (!this._navActive || this._navPaused) return;

    // Heading from displacement between fixes (chosen over device compass
    // — no extra permission prompt, consistent outdoors). Ignore tiny/
    // jittery moves so standing still doesn't spin the map at random.
    if (prevLat != null && prevLng != null) {
      const movedM = this._haversineKm(prevLat, prevLng, lat, lng) * 1000;
      if (movedM > 3) {
        const raw = this._bearingDeg(prevLat, prevLng, lat, lng);
        this._navHeading = this._smoothHeading(raw);
        if (State.planMap.setBearing) State.planMap.setBearing(-this._navHeading);
      }
    }

    if (this._navRoutePoints.length >= 2) {
      const closest = this._closestPointOnRoute(lat, lng, this._navRoutePoints);
      if (closest) {
        if (closest.distM > this.OFF_ROUTE_M) {
          this._offRouteStreak++;
          if (this._offRouteStreak >= this.OFF_ROUTE_STREAK && !this._navOffRoute) {
            this._reroute();
          }
        } else {
          this._offRouteStreak = 0;
          if (!this._navOffRoute) {
            this._navRoutePoints = this._trimRouteAhead(this._navRoutePoints, closest);
            if (this._routeLayer) this._routeLayer.setLatLngs(this._navRoutePoints);
          }
        }
      }
    }

    this._checkArrival();
  },
};

/* ═══════════════════════════════════════════════
   PROFILE CONTROLLER
═══════════════════════════════════════════════ */
const ProfileCtrl = {
  init() {
    // Settings gear (top-right of profile) opens accountModal — replaces
    // the old "tap avatar to open modal" gesture (avatar removed from
    // main profile in favor of the community identity header below).
    document.getElementById('settingsGearBtn')?.addEventListener('click', () => {
      this._openAccountModal();
    });
    this._initAccountModal();

    // Mời bạn bè — link cá nhân hoá ?ref=<my_id>, tracked bởi invited_by
    // (xem functions/api/register.js). Nút chỉ hiện khi đã đăng nhập
    // (_renderMyRestaurants toggle .hidden trên #inviteCard), nhưng vẫn
    // guard ở đây phòng bấm trúng lúc DOM chưa kịp ẩn.
    document.getElementById('inviteBtn')?.addEventListener('click', async () => {
      if (!Community.isLoggedIn()) return;
      const url = `${location.origin}/?ref=${encodeURIComponent(Community.currentUser.id)}`;
      try {
        await navigator.clipboard.writeText(url);
        showToast(I18N.t('toast.linkCopied'));
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); showToast(I18N.t('toast.linkCopied')); }
        catch (_) { showToast(I18N.t('toast.linkCopyFail')); }
        document.body.removeChild(ta);
      }
      if (typeof Analytics !== 'undefined') Analytics.track('invite_link_copied', {});
    });

    // Bật/tắt thông báo follow — xem js/push.js. Nút bị disable ở
    // _renderPushToggle() khi trình duyệt không hỗ trợ, nên tới đây chắc
    // chắn Push.isSupported() === true.
    document.getElementById('pushNotifToggle')?.addEventListener('click', async (e) => {
      const sw = e.currentTarget;
      if (sw.classList.contains('disabled')) return;
      const wasSubscribed = sw.dataset.subscribed === '1';
      sw.classList.add('disabled');
      const r = wasSubscribed ? await Push.unsubscribe() : await Push.subscribe();
      if (!r.ok) { showToast(`⚠️ ${r.error}`); }
      else showToast(I18N.t(wasSubscribed ? 'push.disabledToast' : 'push.enabledToast'));
      await this._renderPushToggle();
    });

    document.getElementById('randomPickToggle')?.addEventListener('click', () => {
      State.profile.hideRandomPick = !State.profile.hideRandomPick;
      Storage.save();
      this._renderRandomPickToggle();
      HomeCtrl._updateRandomPickVisibility();
      showToast(I18N.t(State.profile.hideRandomPick ? 'randomPick.disabledToast' : 'randomPick.enabledToast'));
    });

    document.getElementById('friendsRowBtn')?.addEventListener('click', () => {
      document.getElementById('accountModal').classList.remove('show');
      FriendsListModal.open();
    });

    const nameInput = document.getElementById('profileNameInput');
    nameInput.addEventListener('input', () => {
      State.profile.name = nameInput.value;
      // profileNameDisplay no longer exists — community header shows the
      // canonical name now. Keep the local name synced to State only.
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

    // Stat cards removed from main profile (moved into accountModal).
    // Stat click handler kept as a no-op — nothing binds it now.

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
    picker.innerHTML = AVATARS.map(a => `<button type="button" class="avatar-pick-btn" data-avatar="${a}">${svgIcon(a)}</button>`).join('');
    picker.addEventListener('click', e => {
      const btn = e.target.closest('.avatar-pick-btn');
      if (!btn) return;
      const a = btn.dataset.avatar;
      State.profile.avatar = a;
      // avatarBtn was removed from main profile — community header
      // shows the current avatar and re-renders on next _renderMyRestaurants().
      const avBtn = document.getElementById('avatarBtn'); if (avBtn) avBtn.innerHTML = svgIcon(a);
      picker.querySelectorAll('.avatar-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.avatar === a));
      Storage.save();
      // Refresh community header immediately so user sees the change
      ProfileCtrl._renderMyRestaurants();
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
    this._renderPushToggle();
    this._renderRandomPickToggle();
  },

  _renderRandomPickToggle() {
    const sw = document.getElementById('randomPickToggle');
    if (!sw) return;
    sw.classList.toggle('on', !State.profile.hideRandomPick);
  },

  async _renderPushToggle() {
    const sw = document.getElementById('pushNotifToggle');
    const hint = document.getElementById('pushNotifHint');
    if (!sw) return;
    if (typeof Push === 'undefined' || !Push.isSupported()) {
      sw.classList.add('disabled');
      sw.classList.remove('on');
      if (hint) hint.textContent = I18N.t('push.unsupported');
      return;
    }
    sw.classList.remove('disabled');
    const subscribed = await Push.isSubscribed();
    sw.dataset.subscribed = subscribed ? '1' : '0';
    sw.classList.toggle('on', subscribed);
    if (hint) hint.textContent = I18N.t('account.notifHint');
  },

  render() {
    // avatarBtn / profileNameDisplay were removed from main profile —
    // community header inside #myRProfileHeader shows identity now.
    document.getElementById('profileNameInput').value = State.profile.name;
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
    // Stat cards removed — only community header shows counts now.
    // Guard with `?.` so any lingering call is a no-op instead of a
    // TypeError. Elements can be added back later without changing JS.
    const trips = document.getElementById('statTrips');
    if (trips) trips.textContent = State.profile.trips;
    const favEl = document.getElementById('statFav');
    if (favEl) {
      const catPrefs = [...State.profile.prefs].filter(p => CATEGORIES[p]);
      favEl.innerHTML = catPrefs[0] ? CATEGORIES[catPrefs[0]].icon : svgIcon('cat-nhahang');
    }
  },

  _onStatClick(stat) {
    // Dead code path — stat cards were removed. Kept as no-op so any
    // stale listener (e.g. keyboard shortcut) doesn't throw.
  },

  // ── Quán tôi đã đăng lên cộng đồng — xem/lọc/sửa/xoá ─────────────────────
  async _loadMyRestaurants() {
    const list = document.getElementById('myRestaurantList');
    const headerEl = document.getElementById('myRProfileHeader');
    if (!Community.isLoggedIn()) {
      // No community identity yet — render a placeholder header from
      // local profile so the page isn't headless.
      if (headerEl) headerEl.innerHTML = communityProfileHeaderHtml({
        avatar: avatarIcon(State.profile.avatar),
        name: State.profile.name || I18N.t('profile.namePlaceholder'),
        tagline: I18N.t('profile.tagline'),
        postCount: 0, starCount: 0, followerCount: 0, followingCount: 0,
      });
      // Stat elements were removed from main profile — guard against
      // any lingering reference (e.g. hidden diagnostic HTML).
      const s1 = document.getElementById('statMyR'); if (s1) s1.textContent = '0';
      const s2 = document.getElementById('statScore'); if (s2) s2.textContent = '0';
      document.getElementById('inviteCard')?.classList.add('hidden');
      list.innerHTML = `<div class="empty-my-r">
        <div class="em-icon">${svgIcon('status-draft')}</div>
        <div class="em-msg">${I18N.t('em.notLoggedIn')}</div>
        <div class="em-sub">${I18N.t('em.signInToSeeYours')}</div>
      </div>`;
      return;
    }
    list.innerHTML = `<div class="empty-my-r"><div class="em-icon">${svgIcon('status-loading')}</div><div class="em-msg">${I18N.t('em.loading')}</div></div>`;
    const r = await Community.myRestaurants();
    this._myRestaurants = r.ok ? r.data.items : [];
    // Old #statMyR was removed — count is shown in the community header
    // (rendered by _renderMyRestaurants below via the postCount slot).
    const [followerCount, friendsRes, referralCount] = await Promise.all([
      Community.followerCount(Community.currentUser.id),
      Community.myFriends(),
      Community.myReferralCount(Community.currentUser.id),
    ]);
    this._myFollowerCount = followerCount;
    this._myFollowingCount = (friendsRes.ok && friendsRes.data.friends) ? friendsRes.data.friends.length : 0;
    const inviteCard = document.getElementById('inviteCard');
    const inviteText = document.getElementById('inviteText');
    if (inviteCard && inviteText) {
      inviteCard.classList.remove('hidden');
      inviteText.innerHTML = I18N.t('invite.joinedText', { n: referralCount });
    }
    this._renderMyRestaurants();
    this._loadMyScore();
  },

  async _loadMyScore() {
    const counts = await Promise.all(this._myRestaurants.map(r => Community.voteCount(r.id)));
    const total = counts.reduce((a, b) => a + b, 0);
    this._myStarTotal = total;
    // Header was already drawn with a "…" placeholder star count before this
    // resolved (votes need their own round-trip per restaurant) — patch it
    // in now that the real total is known. Header lives in
    // #myRProfileHeader now (moved out of #myRestaurantList to sit ABOVE
    // the filter tabs, matching the Instagram-style layout).
    const headerStat = document.querySelector('#myRProfileHeader .social-stat span[data-star-total]');
    if (headerStat) headerStat.textContent = total;
  },

  _renderMyRestaurants() {
    const list = document.getElementById('myRestaurantList');
    const headerEl = document.getElementById('myRProfileHeader');
    const items = this._myRFilter === 'all'
      ? this._myRestaurants
      : this._myRestaurants.filter(r => COMMUNITY_PB_TO_CAT[r.category] === this._myRFilter);

    const header = communityProfileHeaderHtml({
      avatar: avatarIcon(State.profile.avatar),
      name: Community.currentUser?.name || State.profile.name || I18N.t('profile.namePlaceholder'),
      tagline: I18N.t('profile.tagline'),
      postCount: this._myRestaurants.length,
      starCount: `<span data-star-total>${this._myStarTotal ?? '···'}</span>`,
      followerCount: this._myFollowerCount ?? '···',
      followingCount: this._myFollowingCount ?? '···',
    });
    // Header lands ABOVE filter tabs in dedicated container so layout
    // matches Instagram-style profile (identity → tabs → grid).
    if (headerEl) headerEl.innerHTML = header;

    if (!items.length) {
      // Empty state — logged-in users get a direct CTA to the community
      // add-quán modal. Guests just see the message (no post permission).
      const loggedIn = Community.isLoggedIn();
      list.innerHTML = `<div class="empty-my-r">
        <div class="em-icon">${svgIcon('status-draft')}</div>
        <div class="em-msg">${I18N.t('em.noRestaurantsYet')}</div>
        <div class="em-sub">${I18N.t('em.postToSeeHere')}</div>
        ${loggedIn ? `<button class="em-cta" id="emCtaPostFirst" type="button">＋ ${I18N.t('em.postFirst')}</button>` : ''}
      </div>`;
      if (loggedIn) {
        document.getElementById('emCtaPostFirst')?.addEventListener('click', () => CommunityAddModal.open());
      }
      return;
    }

    list.innerHTML = `<div class="social-grid">${items.map(r => communityGridCellHtml(r)).join('')}</div>`;
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
    if (typeof Analytics !== 'undefined') Analytics.track('detail_open', {
      source: r._gemini ? 'gemini' : (r._community ? 'community' : (r.id >= 1e13 ? 'osm' : 'mine')),
      has_image: !!r.image,
      has_coords: r.lat != null && r.lng != null,
    });
    const cat = CATEGORIES[r.cat] || { label: '—', color: '#888', icon: svgIcon('cat-nhahang') };
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
    const demoNote = `<div class="detail-demo-note"><em>Ứng dụng đang trong giai đoạn demo nên có thể ghi sai địa chỉ — bấm ${svgIcon('map-external')} Google Maps để xem địa chỉ &amp; chỉ đường chính xác.</em></div>`;
    let addressHtml = '';
    if (isGemini) {
      // Show Gemini's (approximate) address like before, plus a clear
      // demo disclaimer steering the user to Google Maps for the exact one.
      if (r.address) addressHtml = `<div class="detail-address">${svgIcon('social-home-address')} ${escape(r.address)}</div>`;
      addressHtml += demoNote;
    } else if (r.address || r._resolvedAddress) {
      addressHtml = `<div class="detail-address">${svgIcon('social-home-address')} ${escape(r.address || r._resolvedAddress)}</div>`;
    } else if (hasCoords) {
      addressHtml = `<div class="detail-address" id="_detailAddrPending">${svgIcon('social-home-address')} <em style="opacity:.6">Đang tra địa chỉ…</em></div>`;
    }
    const knownAddress = (!isGemini && (r.address || r._resolvedAddress)) || null;
    // Coords line — small hint only for accurate (non-Gemini) sources
    // when we don't yet have a human address.
    const coordsHtml = !hasCoords
      ? `<div class="detail-coords warn">${svgIcon('status-warning')} Chưa có vị trí trên map · chỉnh sửa hoặc thêm mới để gắn vị trí</div>`
      : (knownAddress || isGemini ? '' : `<div class="detail-coords">${svgIcon('action-gps')} ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</div>`);

    body.innerHTML = `
      ${imgHtml}
      <div class="detail-cat-wrap">
        <span class="detail-cat" style="color:${cat.color};background:${cat.color}18">${cat.icon} ${escape(cat.label)}</span>
      </div>
      <div class="detail-name">${escape(r.name)}</div>
      <div class="detail-meta">
        <span>${svgIcon('price-mid')} ${escape(r.price || '—')}</span>
        <span>${svgIcon('rating-star-filled')} ${(r.rating ?? 5).toFixed(1)}</span>
        ${r.hours ? `<span>${svgIcon('route-time-window')} ${escape(r.hours)}</span>` : ''}
      </div>
      ${isGemini ? `<div class="detail-demo-note">${I18N.t('detail.geminiRefNote')}</div>` : ''}
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
          pending.innerHTML = `${svgIcon('social-home-address')} ${escape(addr)}`;
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
          <div class="list-empty-icon">${svgIcon('food-pho')}</div>
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
              <div class="trip-stop-addr">${esc(s.address || (s.lat != null ? `${svgIcon('action-gps')} ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : I18N.t('trips.noAddress')))}</div>
            </div>
          </div>`).join('');
        return `
          <div class="trip-item">
            <div class="trip-date-row">
              <div class="trip-date">${svgIcon('route-calendar')} ${dateLabel} · ${trip.stops.length} điểm</div>
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
  get binh_dan() { return `${svgIcon('price-budget')} ${I18N.t('priceLabel.cheap')}`; },
  get tam_trung() { return `${svgIcon('price-mid')} ${I18N.t('priceLabel.mid')}`; },
  get sang_chanh() { return `${svgIcon('price-premium')} ${I18N.t('priceLabel.premium')}`; },
};
const COMMUNITY_VIS_BADGE = { private: svgIcon('privacy-lock'), friends: svgIcon('privacy-friends'), public: svgIcon('privacy-globe') };

// Instagram-style feed post — used ONLY by the Cộng đồng browse tab
// (CommunityCtrl._renderList). Profile-type views ("Quán của tôi",
// UserQuanModal) use communityGridCellHtml() instead — see that function.
// Author avatar/edit-delete is handled elsewhere (CommunityDetailModal
// branches on ownership when a card is tapped), so this is pure display.
// `groupCount` — số bài KHÁC cùng nhóm "cùng 1 quán" ĐÃ NẰM SẴN trong danh
// sách đang render (tính ở nơi gọi, từ dữ liệu đã tải, KHÔNG gọi thêm API
// nào — xem CommunityCtrl._renderList()). Chỉ là tín hiệu ước lượng rẻ cho
// feed; con số chính xác đầy đủ (kể cả bài ngoài danh sách này) nằm ở
// CommunityDetailModal khi bấm vào xem.
function communityCardHtml(r, groupCount = 0) {
  const catKey = COMMUNITY_PB_TO_CAT[r.category] || 'restaurant';
  const cat = CATEGORIES[catKey];
  const priceLabel = COMMUNITY_PRICE_LABEL[r.price_range] || '';
  // Khung 4:5 (chuẩn Instagram) — 3:4 đo được cắt ít hơn 1 chút trên ảnh
  // thật của app (~15% vs ~18% trung bình), nhưng chọn 4:5 cho quen mắt
  // người dùng đã dùng Instagram. Crop-fill server-side (không có hậu tố
  // 'f') để PocketBase cache đúng size cần, đỡ tải lại.
  const photos = Community.photoUrls(r, '640x800');
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
  // Fallback: if users.viewRule blocks expand, show own name on own posts
  const _cu = typeof Community !== 'undefined' && Community.currentUser;
  const _isMine = _cu && (r.created_by === _cu.id);
  const authorName = (author && author.name) || (_isMine && _cu.name) || I18N.t('common.anonymous');
  const authorId = (author && author.id) || r.created_by || '';
  const isSaved = State.savedPosts.has(r.id);

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
        <button class="heart-btn" data-id="${r.id}"><span class="heart-ico">${svgIcon('heart-outline')}</span></button>
        <span class="heart-count">···</span>
        <button class="post-action-btn comment-icon-btn" type="button" data-id="${r.id}" title="${I18N.t('comment.title')}">${svgIcon('social-comment')}</button>
        <button class="post-action-btn share-icon-btn" type="button" data-id="${r.id}" title="${I18N.t('detail.copyLink')}">${svgIcon('action-copy-link')}</button>
        <button class="post-action-btn save-icon-btn${isSaved ? ' on' : ''}" type="button" data-id="${r.id}" title="${I18N.t('detail.save')}">${svgIcon('action-bookmark')}</button>
      </div>
      <div class="post-badge-row">
        <span class="post-cat-pill" style="color:${cat.color};background:${cat.color}18">${cat.icon} ${cat.label}${priceLabel ? ' · ' + priceLabel : ''}</span>
      </div>
      <div class="post-caption"><b>${escapeHtml(r.name)}</b>${r.description ? ' ' + escapeHtml(r.description) : ''}</div>
      ${(tagsHtml || hashHtml) ? `<div class="comm-r-chips">${tagsHtml}${hashHtml}</div>` : ''}
      ${groupCount > 0 ? `<div class="dup-group-hint">${svgIcon('action-invite-link')} ${I18N.t('post.alsoPostedBy', { n: groupCount })}</div>` : ''}
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
// followingCount: CHỦ ĐỘNG chỉ truyền vào khi render header của CHÍNH CHỦ
// (ProfileCtrl) — không truyền ở UserQuanModal (xem profile người khác).
// "Đang theo dõi ai" là thông tin riêng tư, không public như 3 số kia.
function communityProfileHeaderHtml({ avatar, name, tagline, postCount, starCount, followerCount, followingCount, followBtn }) {
  const followingStat = followingCount != null
    ? `<div class="social-stat" data-stat="following" role="button" tabindex="0"><b>${followingCount}</b><span>${I18N.t('social.following')}</span></div>`
    : '';
  return `<div class="social-profile-header">
    <div class="social-avatar">${avatar}</div>
    <div class="social-name">${escapeHtml(name)}</div>
    ${tagline ? `<div class="social-tagline">${tagline}</div>` : ''}
    <div class="social-stats">
      <div class="social-stat" data-stat="posts"><b>${postCount}</b><span>${I18N.t('social.posts')}</span></div>
      <div class="social-stat" data-stat="stars"><b>${starCount}</b><span>${I18N.t('social.stars')}</span></div>
      <div class="social-stat" data-stat="followers" role="button" tabindex="0"><b>${followerCount}</b><span>${I18N.t('social.followers')}</span></div>
      ${followingStat}
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


// Copy link tới 1 bài viết cộng đồng — dùng chung cho nút 📤 trên card feed
// VÀ nút "📋 Sao chép link" trong CommunityDetailModal (trước đây code lặp
// lại y hệt ở 2 nơi, giờ chỉ 1 chỗ).
async function copyPostLink(id) {
  const url = `${location.origin}/?q=${encodeURIComponent(id)}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast(I18N.t('toast.linkCopied'));
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast(I18N.t('toast.linkCopied')); }
    catch (_) { showToast(I18N.t('toast.linkCopyFail')); }
    document.body.removeChild(ta);
  }
}

// Toggle bookmark 1 bài (localStorage-only, không cần login) — dùng chung
// cho nút 🔖 trên card feed VÀ nút "Lưu" trong CommunityDetailModal. Trả về
// trạng thái MỚI (true = vừa lưu) để caller tự cập nhật UI của mình.
function toggleSavedPost(id) {
  const wasSaved = State.savedPosts.has(id);
  if (wasSaved) State.savedPosts.delete(id);
  else State.savedPosts.add(id);
  Storage.save();
  showToast(I18N.t(wasSaved ? 'toast.postUnsaved' : 'toast.postSaved'));
  return !wasSaved;
}

// Bình luận/Chia sẻ/Lưu ngay trên card feed — share+save thực hiện thẳng
// hành động (không cần mở modal); comment mở CommunityDetailModal và tự
// cuộn tới ô nhập, vì bình luận cần cả ô nhập + danh sách, không "1 chạm
// xong" được như 2 cái kia.
function wireCardActions(container, items) {
  container.querySelectorAll('.comment-icon-btn[data-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = items.find(x => x.id === btn.dataset.id);
      if (r) CommunityDetailModal.open(r, { focusComment: true });
    });
  });
  container.querySelectorAll('.share-icon-btn[data-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyPostLink(btn.dataset.id);
    });
  });
  container.querySelectorAll('.save-icon-btn[data-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowSaved = toggleSavedPost(btn.dataset.id);
      btn.classList.toggle('on', nowSaved);
    });
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
  btn.querySelector('.heart-ico').innerHTML = mine ? svgIcon('heart-filled') : svgIcon('heart-outline');
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
// theyFollowMe: đã biết trước lúc render (đọc thẳng field `friends` của đối
// phương — users.viewRule/listRule mở cho mọi người đăng nhập, xem migration
// 1725700005 — nên không tốn thêm request nào). Dùng để mô phỏng cơ chế
// TikTok: theo dõi lẫn nhau → "🤝 Bạn bè"; họ theo dõi mình trước → gợi ý
// "Theo dõi lại" kèm tag "Đã theo dõi bạn".
function followBtnHtml(userId, userName, following, theyFollowMe = false) {
  const mutual = following && theyFollowMe;
  const label = mutual ? I18N.t('follow.mutual')
    : following ? I18N.t('follow.following')
    : theyFollowMe ? I18N.t('follow.followBack')
    : I18N.t('follow.notFollowing');
  const cls = mutual ? ' following mutual' : (following ? ' following' : '');
  const tag = (!following && theyFollowMe) ? `<span class="follows-you-tag">${I18N.t('follow.followsYou')}</span>` : '';
  return `<span class="follow-btn-wrap">${tag}<button type="button" class="follow-btn${cls}" data-user-id="${userId}" data-user-name="${escapeHtml(userName)}" data-they-follow-me="${theyFollowMe ? '1' : '0'}">${label}</button></span>`;
}
function wireFollowButtons(container, onChange) {
  container.querySelectorAll('.follow-btn[data-user-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.userId;
      const isFollowing = btn.classList.contains('following');
      const theyFollowMe = btn.dataset.theyFollowMe === '1';
      btn.disabled = true;
      const r = isFollowing ? await Community.removeFriend(id) : await Community.addFriend(id);
      btn.disabled = false;
      if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
      const nowFollowing = !isFollowing;
      if (typeof Analytics !== 'undefined' && nowFollowing) {
        // Only the follow direction — unfollow is negative engagement,
        // separate metric later if we ever need to look at churn.
        Analytics.track('follow', {});
      }
      // Push notification to the person just followed — fire-and-forget,
      // never blocks the follow UI or shows an error if it fails (best-
      // effort, see functions/api/notify-follow.js header for why).
      if (nowFollowing && Community.currentUser) {
        fetch('/api/notify-follow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ followerUserId: Community.currentUser.id, followedUserId: id }),
        }).catch(() => {});
      }
      const nowMutual = nowFollowing && theyFollowMe;
      btn.classList.toggle('following', nowFollowing);
      btn.classList.toggle('mutual', nowMutual);
      btn.textContent = nowMutual ? I18N.t('follow.mutual')
        : nowFollowing ? I18N.t('follow.following')
        : theyFollowMe ? I18N.t('follow.followBack')
        : I18N.t('follow.notFollowing');
      // Tag "Đã theo dõi bạn" chỉ có ý nghĩa khi MÌNH chưa theo dõi lại —
      // theo dõi xong (dù chưa chắc mutual do theyFollowMe có thể sai lệch
      // nhẹ nếu đối phương vừa bỏ theo dõi mình) thì ẩn tag đi.
      const wrap = btn.closest('.follow-btn-wrap');
      const existingTag = wrap && wrap.querySelector('.follows-you-tag');
      if (wrap) {
        if (!nowFollowing && theyFollowMe && !existingTag) {
          wrap.insertAdjacentHTML('afterbegin', `<span class="follows-you-tag">${I18N.t('follow.followsYou')}</span>`);
        } else if (nowFollowing && existingTag) {
          existingTag.remove();
        }
      }
      showToast(nowMutual ? I18N.t('toast.nowMutual') : nowFollowing ? I18N.t('toast.nowFollowing') : I18N.t('toast.unfollowed'));
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

  // ── Feed tự cập nhật ────────────────────────────────────────────────
  // Trước đây bài mới của người khác chỉ hiện sau khi F5 — đang xem thì
  // không biết có gì mới, phải tự đoán mà tải lại.
  LIVE_POLL_MS: 20000,
  _liveTimer: null,
  _liveSig: null,        // chữ ký của lần ĐÃ VẼ gần nhất (null = chưa có mốc)
  _liveTotal: 0,         // tổng số bài của lần đã vẽ, để tính số bài mới
  _liveBusy: false,      // chặn chồng request khi mạng chậm hơn chu kỳ poll
  _pendingNew: 0,

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

    document.getElementById('communityNewPill')?.addEventListener('click', () => this._showNewPosts());

    // Rời tab trình duyệt / khoá máy → dừng poll. Quay lại → kiểm tra
    // NGAY, không đợi hết 20s, vì đó đúng là lúc người dùng nhìn lại feed.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && State.currentTab === 'community') this._startLive();
      else this._stopLive();
    });

    const search = document.getElementById('communitySearchInput');
    search.addEventListener('input', () => {
      clearTimeout(this._searchDebounce);
      this._searchDebounce = setTimeout(() => this._loadList(search.value.trim()), 350);
    });

    // Quán ăn / Check-in / Lộ trình — 3 panes, exactly one visible.
    // Switching to Check-in force-refreshes the bubbles (bypasses the 5s
    // debounce inside CheckinFeedCtrl.refresh) so the user always lands
    // on the freshest view.
    document.querySelectorAll('.comm-subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.comm-subtab').forEach(b => b.classList.toggle('active', b === btn));
        const which = btn.dataset.commSubtab;
        document.getElementById('communityFoodPane').classList.toggle('hidden', which !== 'food');
        document.getElementById('communityCheckinsPane').classList.toggle('hidden', which !== 'checkins');
        document.getElementById('communityRoutesPane').classList.toggle('hidden', which !== 'routes');
        if (which === 'checkins' && typeof CheckinFeedCtrl !== 'undefined') {
          CheckinFeedCtrl.refresh({ force: true });
          if (typeof CheckinDiscoverCtrl !== 'undefined') CheckinDiscoverCtrl.refresh();
        }
      });
    });

    // Lướt feed → tab bar tự ẩn/hiện qua TabNav.wireScrollHide, còn ô tìm kiếm
    // ẩn/hiện riêng ở đây vì chỉ áp dụng cho màn cộng đồng.
    const commScroll = document.querySelector('#communityScreen .profile-scroll');
    TabNav.wireScrollHide(commScroll);
    const commSearchGroup = document.getElementById('communitySearchGroup');
    let commLastScrollTop = 0;
    commScroll.addEventListener('scroll', () => {
      const st = commScroll.scrollTop;
      if (st > commLastScrollTop && st > 30) commSearchGroup.classList.add('scroll-collapsed');
      else if (st < commLastScrollTop) commSearchGroup.classList.remove('scroll-collapsed');
      commLastScrollTop = st <= 0 ? 0 : st;
    }, { passive: true });

    // Observer màu chữ header được (re)tạo trong render() thay vì ở đây —
    // #communityScreen còn "hidden" lúc init() chạy (boot app), nên
    // commScroll.clientHeight = 0 và rootMargin tính sai. render() chạy
    // mỗi lần mở tab Cộng đồng, lúc đó màn đã hiện, kích thước mới đúng.

    // Small "Đăng nhập" header button (guest only) opens the auth form.
    // Defaults to login mode — the button label says "Đăng nhập", so
    // that's what the user expects to land on.
    document.getElementById('communityGuestSignIn')?.addEventListener('click', () => {
      document.getElementById('communityAuth').classList.remove('hidden');
      document.getElementById('communityMain').classList.add('hidden');
      this._mode = 'login';
      this._renderAuthMode();
      document.getElementById('cAuthEmail')?.focus();
    });

    // "Xem quán trước" link in auth form → back to browse-first view
    document.getElementById('communityAuthBack')?.addEventListener('click', () => {
      document.getElementById('communityAuth').classList.add('hidden');
      document.getElementById('communityMain').classList.remove('hidden');
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
              <span class="follow-name" data-user-id="${u.id}" data-user-name="${escapeHtml(u.name || I18N.t('common.anonymous'))}">${svgIcon('social-author')} ${escapeHtml(u.name || I18N.t('common.anonymous'))}</span>
              ${followBtnHtml(u.id, u.name || I18N.t('common.anonymous'), followingIds.has(u.id), (u.friends || []).includes(Community.currentUser?.id))}
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
    const r = await Community.myFriends();
    const friends = (r.ok && r.data.expand && r.data.expand.friends) || [];
    const countEl = document.getElementById('friendsRowCount');
    if (countEl) countEl.textContent = I18N.t('account.friendsCountLabel', { n: friends.length });

    const el = document.getElementById('friendList');
    if (!el) return;
    if (!friends.length) {
      el.innerHTML = `<span style="font-size:.78rem;color:var(--text3)">${I18N.t('em.noFriendsYet')}</span>`;
      return;
    }
    el.innerHTML = friends.map(u => `<span class="chip-tag"><span data-user-id="${u.id}" data-user-name="${escapeHtml(u.name || I18N.t('common.anonymous'))}" style="cursor:pointer">${svgIcon('social-author')} ${escapeHtml(u.name || I18N.t('common.anonymous'))}</span><button type="button" class="chip-tag-remove" data-id="${u.id}">${svgIcon('action-close')}</button></span>`).join('');
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
    document.getElementById('communityTurnstileGroup').classList.toggle('hidden', !isRegister);
    document.getElementById('communityAuthSubmit').textContent = isRegister ? I18N.t('community.register') : I18N.t('community.signIn');
    document.getElementById('communityAuthToggle').textContent = isRegister
      ? I18N.t('community.toLogin') : I18N.t('community.toRegister');
    if (isRegister) this._ensureTurnstile();
  },

  // Explicit-render Turnstile widget. Previously we let api.js auto-scan the
  // DOM at load time, but the .cf-turnstile div starts inside a .hidden
  // container (Đăng ký tab isn't the default mode) — Turnstile's implicit
  // render silently no-ops on hidden containers and never retries when
  // visibility flips later. Result: users toggled to Đăng ký, saw an empty
  // widget slot, submitted, got "Đợi xác thực chống bot xong đã nhé" toast.
  // Explicit render (index.html script has ?render=explicit&onload=...)
  // lets us call turnstile.render() the first time user opens register mode.
  _ensureTurnstile() {
    const el = document.getElementById('communityTurnstile');
    if (!el || this._turnstileWidgetId) return;
    const doRender = () => {
      try {
        this._turnstileWidgetId = window.turnstile.render(el, {
          sitekey: el.getAttribute('data-sitekey'),
          action: el.getAttribute('data-action') || 'register',
        });
      } catch (e) { console.warn('[Turnstile] render failed:', e?.message || e); }
    };
    if (window.turnstile && window.turnstile.render) {
      doRender();
    } else {
      // api.js not loaded yet — chain into its onload callback. Multiple
      // callers layer safely by preserving any previous handler.
      const prev = window.onloadTurnstileCallback;
      window.onloadTurnstileCallback = () => { if (prev) { try { prev(); } catch(_){} } doRender(); };
    }
  },

  async _submitAuth() {
    const email = document.getElementById('cAuthEmail').value.trim();
    const password = document.getElementById('cAuthPassword').value;
    const name = document.getElementById('cAuthName').value.trim();
    if (!email || !password) { showToast(I18N.t('toast.fillEmailPassword')); return; }
    if (this._mode === 'register' && password.length < 8) { showToast(I18N.t('toast.passwordMin8')); return; }

    // Bot check only gates NEW account creation — login stays untouched.
    // With explicit render (see _ensureTurnstile above), getResponse/reset
    // take the widget ID string returned by turnstile.render(). If the
    // widget hasn't rendered yet (api.js still loading, or register mode
    // opened for the first time this frame), tell the user to wait rather
    // than the generic "cần xác thực" which reads like the user did
    // something wrong.
    let turnstileToken = null;
    if (this._mode === 'register') {
      if (!window.turnstile || !this._turnstileWidgetId) {
        // Widget not ready — try to kick off render for next attempt.
        this._ensureTurnstile();
        showToast(I18N.t('toast.turnstileLoading'));
        return;
      }
      try { turnstileToken = window.turnstile.getResponse(this._turnstileWidgetId) || null; } catch (_) { turnstileToken = null; }
      if (!turnstileToken) { showToast(I18N.t('toast.turnstileRequired')); return; }
    }

    const btn = document.getElementById('communityAuthSubmit');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = I18N.t('auth.processing');
    let invitedBy = null;
    if (this._mode === 'register') {
      try { invitedBy = sessionStorage.getItem('nhopnhep_ref') || null; } catch (_) {}
    }
    const r = this._mode === 'register'
      ? await Community.register(email, password, name, turnstileToken, invitedBy)
      : await Community.login(email, password);
    btn.disabled = false; btn.textContent = original;

    // Turnstile tokens are single-use — always reset after an attempt so
    // a retry (this one failing, or the next registration this same page
    // load) gets a fresh token instead of silently reusing a spent one.
    if (this._mode === 'register' && this._turnstileWidgetId) {
      try { window.turnstile?.reset(this._turnstileWidgetId); } catch (_) {}
    }

    if (!r.ok) {
      // Special case: account was created but auto-login failed (tunnel blip).
      // Switch to login mode so the user can immediately sign in manually
      // without re-filling all the register fields.
      if (r._registered) {
        this._mode = 'login';
        this._renderAuthMode();
        document.getElementById('cAuthEmail').value = email;
      }
      showToast(`⚠️ ${r.error}`);
      return;
    }
    if (typeof Analytics !== 'undefined') {
      Analytics.track(this._mode === 'register' ? 'register' : 'login', {});
    }
    showToast(this._mode === 'register' ? I18N.t('toast.registered') : I18N.t('toast.loginSuccess'));
    document.getElementById('cAuthPassword').value = '';
    // Referral consumed — clear so a later logout+register in the same tab
    // session doesn't wrongly re-attribute a second, unrelated account.
    if (this._mode === 'register') { try { sessionStorage.removeItem('nhopnhep_ref'); } catch (_) {} }
    // One-time backfill: this account's avatar_emoji field didn't exist
    // until this session's redesign, so anyone who already picked an
    // emoji locally (or just registered, which never sets one) needs it
    // pushed up once so their posts show the right avatar to others.
    if (!r.data.avatar_emoji) Community.updateAvatar(State.profile.avatar);
    this.render();
  },

  // Cap for anonymous browse-first preview. Small enough to feel like
  // a taste, big enough to prove the community's alive.
  GUEST_CAP: 10,

  render() {
    const loggedIn = Community.isLoggedIn();
    // Main content shows always now — guests get the browse-first view
    // with capped list + CTA banners; auth form only pops up on demand.
    document.getElementById('communityAuth').classList.add('hidden');
    document.getElementById('communityMain').classList.remove('hidden');
    // Toggle features that only make sense once signed in
    document.getElementById('communityAddBtn').classList.toggle('hidden', !loggedIn);
    document.getElementById('communitySearchGroup').classList.toggle('hidden', !loggedIn);
    // Small "Đăng nhập" header button — visible only to guests
    document.getElementById('communityGuestSignIn').classList.toggle('hidden', loggedIn);
    // Tạo lại observer màu chữ header MỖI LẦN mở tab — màn hình vừa hết
    // "hidden" nên kích thước đo được ở đây mới đúng (init() chạy lúc boot,
    // màn còn ẩn, đo lúc đó sẽ ra 0). Rẻ: chỉ 1 observer, huỷ cái cũ trước.
    this._initSubtabContrastObserver(
      document.querySelector('#communityScreen .profile-scroll'),
      document.querySelector('.comm-subtabs')
    );
    this._loadList('');
    this._startLive();
  },

  // ── Live: vòng đời poller ───────────────────────────────────────────
  // Chỉ chạy khi tab Cộng đồng đang mở VÀ trình duyệt đang hiện — không
  // đốt pin/data nền, và quan trọng hơn: khi người dùng quay lại thì
  // kiểm tra NGAY, đó mới là lúc họ thật sự cần thấy bài mới.
  _startLive() {
    this._stopLive();
    if (document.visibilityState !== 'visible') return;
    this._liveTimer = setInterval(() => this._pollLive(), this.LIVE_POLL_MS);
    this._pollLive();
  },

  _stopLive() {
    clearInterval(this._liveTimer);
    this._liveTimer = null;
  },

  _isLiveActive() {
    return State.currentTab === 'community' && document.visibilityState === 'visible';
  },

  async _pollLive() {
    if (this._liveBusy || !this._isLiveActive()) return;
    // Đang tìm kiếm: kết quả là của riêng câu tìm, tráo nó ra dưới tay
    // người dùng thì khó chịu hơn là để họ tự tìm lại.
    if ((document.getElementById('communitySearchInput')?.value || '').trim()) return;

    this._liveBusy = true;
    let probe = null;
    try { probe = await Community.feedSignature(); }
    finally { this._liveBusy = false; }
    // Mất mạng / server ngủ: im lặng bỏ qua, lần poll sau thử lại. Đây là
    // tiện ích nền, không được phép bắn toast lỗi vào mặt người dùng.
    if (!probe || !this._isLiveActive()) return;

    if (this._liveSig === null) { // lần đầu sau khi vẽ list → chỉ lấy mốc
      this._liveSig = probe.sig;
      this._liveTotal = probe.total;
      return;
    }
    if (probe.sig === this._liveSig) return;

    const delta = probe.total - this._liveTotal;
    const scroller = document.querySelector('#communityScreen .profile-scroll');
    const atTop = !scroller || scroller.scrollTop < 80;

    // Ở đỉnh feed thì vẽ lại luôn: không có gì phía trên để bị xê dịch,
    // bài mới trồi lên đúng chỗ mắt đang nhìn.
    if (atTop) { this._loadList(''); return; }

    // Đang cuộn giữa feed: KHÔNG tráo nội dung dưới tay người dùng.
    // Có bài mới → hiện pill để họ tự quyết định lúc nào xem.
    if (delta > 0) { this._pendingNew = delta; this._renderNewPill(); }
    // Chỉ sửa/xoá (delta <= 0): không hiện pill ("0 quán mới" vô nghĩa).
    // Cố tình KHÔNG cập nhật _liveSig để lần poll sau vẫn thấy lệch và
    // sẽ vẽ lại ngay khi người dùng cuộn về đỉnh.
  },

  _renderNewPill() {
    const pill = document.getElementById('communityNewPill');
    if (!pill) return;
    if (!this._pendingNew) { pill.classList.add('hidden'); return; }
    pill.textContent = I18N.t('community.newPosts', { n: this._pendingNew });
    pill.classList.remove('hidden');
  },

  _showNewPosts() {
    const scroller = document.querySelector('#communityScreen .profile-scroll');
    scroller?.scrollTo({ top: 0, behavior: 'smooth' });
    this._loadList('');
  },

  async _loadList(query) {
    const list = document.getElementById('communityList');
    list.innerHTML = `<div class="empty-comm"><div class="em-icon">${svgIcon('status-loading')}</div><div class="em-msg">${I18N.t('em.loading')}</div></div>`;
    const loggedIn = Community.isLoggedIn();
    // Guests: browse-first preview capped to GUEST_CAP (10) newest quán,
    // no search box. Logged-in users: full list + search.
    const r = query
      ? await Community.searchRestaurants(query)
      : await Community.listRestaurants({ perPage: loggedIn ? 50 : this.GUEST_CAP });
    if (!r.ok) {
      list.innerHTML = `<div class="empty-comm">
        <div class="em-icon">${svgIcon('status-error-face')}</div><div class="em-msg">${I18N.t('em.loadFail')}</div>
        <div class="em-sub">${escapeHtml(r.error)}</div>
      </div>`;
      return;
    }
    this._renderList(r.data.items, query);

    // Vừa vẽ xong = mọi thứ đang hiện là mới nhất → dọn pill và đặt lại
    // mốc. _liveSig=null khiến lần poll ngay sau đây chỉ lấy mốc chứ
    // không coi là "có thay đổi", nên không bao giờ tự vẽ lại 2 lần.
    this._pendingNew = 0;
    this._renderNewPill();
    this._liveSig = null;
    if (this._isLiveActive()) this._pollLive();
  },

  // query khác rỗng khi đang tìm kiếm — 0 kết quả lúc đó nghĩa là "không
  // khớp", không phải "cộng đồng chưa có quán nào" (2 tình huống khác hẳn
  // nhau, gộp chung dễ hiểu lầm là cả cộng đồng trống trơn).
  _renderList(items, query) {
    const list = document.getElementById('communityList');
    if (!items.length) {
      list.innerHTML = query
        ? `<div class="empty-comm">
            <div class="em-icon">${svgIcon('action-search')}</div>
            <div class="em-msg">${I18N.t('em.noMatchFor', { q: escapeHtml(query) })}</div>
            <div class="em-sub">${I18N.t('em.tryShorterQuery')}</div>
          </div>`
        : `<div class="empty-comm">
            <div class="em-icon">${svgIcon('cat-nhahang')}</div>
            <div class="em-msg">${I18N.t('em.communityEmpty')}</div>
            <div class="em-sub">${I18N.t('em.postFirst')}</div>
          </div>`;
      return;
    }
    // Đếm "cùng nhóm" NGAY TRÊN danh sách đã tải sẵn — không gọi thêm API
    // nào. Chỉ nhóm những bài đã cùng nằm trong `items` (đã được server lọc
    // đúng quyền xem của người này), nên không có đường rò rỉ nào mới.
    const groupCounts = new Map();
    items.forEach(r => {
      const root = Community.resolveRootId(r);
      groupCounts.set(root, (groupCounts.get(root) || 0) + 1);
    });
    list.innerHTML = items.map(r => communityCardHtml(r, (groupCounts.get(Community.resolveRootId(r)) || 1) - 1)).join('');
    wireHeartButtons(list);
    wireAuthorButtons(list);
    wireCarousels(list);
    wireCardDetail(list, items);
    wireCardActions(list, items);
    this._observeSubtabPhotos();
  },

  // ── Header .comm-subtabs — màu chữ tự đổi theo nội dung ngay dưới ────
  // Nền .comm-subtabs LUÔN đặc (không đổi — yêu cầu Vinh 2026-09-19).
  // Chỉ màu CHỮ đổi: khi có .post-photo (ảnh, nhiều màu/tối) nằm ngay
  // dưới header, giữ màu chữ mặc định; khi vùng ngay dưới header là
  // .post-head/.post-body (nền trắng/kem, cùng tông với header) thì thêm
  // class .on-light để chữ đổi tối hơn, tránh chìm vào nền liền màu.
  // Dùng IntersectionObserver (rẻ hơn nhiều so với đọc getBoundingClientRect
  // của mọi .post-photo trên mỗi sự kiện scroll) — root là chính khung cuộn
  // feed, rootMargin thu hẹp vùng "visible" xuống đúng dải cao bằng header.
  _subtabContrastObserver: null,
  _initSubtabContrastObserver(scrollEl, subtabsEl) {
    if (!scrollEl || !subtabsEl || !('IntersectionObserver' in window)) return;
    this._subtabContrastObserver?.disconnect();
    const hdrH = subtabsEl.offsetHeight || 50;
    const intersecting = new Set();
    this._subtabContrastObserver = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) intersecting.add(e.target);
        else intersecting.delete(e.target);
      });
      subtabsEl.classList.toggle('on-light', intersecting.size === 0);
    }, {
      root: scrollEl,
      rootMargin: `0px 0px -${Math.max(scrollEl.clientHeight - hdrH, 0)}px 0px`,
      threshold: 0,
    });
  },
  _observeSubtabPhotos() {
    if (!this._subtabContrastObserver) return;
    document.querySelectorAll('#communityScreen .post-photo').forEach(el => {
      this._subtabContrastObserver.observe(el);
    });
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
  _returnModalId: null,

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

    // Save/unsave (bookmark) — localStorage-only per browser
    document.getElementById('communityDetailSave').addEventListener('click', () => {
      const r = this._current;
      if (!r || !r.id) return;
      toggleSavedPost(r.id);
      this._syncSaveBtn();
    });

    // Copy shareable link — the boot handler in app.js reads ?q=<id>
    // and auto-opens this modal on load.
    document.getElementById('communityDetailCopy').addEventListener('click', () => {
      const r = this._current;
      if (r && r.id) copyPostLink(r.id);
    });

    // Bình luận — nút Gửi + Enter đều submit. Delegated trên body vì
    // #cdmCommentInput/#cdmCommentSend được vẽ lại mỗi lần open() (bên
    // trong innerHTML của #communityDetailBody).
    const bodyEl = document.getElementById('communityDetailBody');
    bodyEl.addEventListener('click', (e) => {
      if (e.target.id === 'cdmCommentSend') this._submitComment();
    });
    bodyEl.addEventListener('keydown', (e) => {
      if (e.target.id === 'cdmCommentInput' && e.key === 'Enter') {
        e.preventDefault();
        this._submitComment();
      }
    });
  },

  _syncSaveBtn() {
    const btn = document.getElementById('communityDetailSave');
    if (!btn || !this._current) return;
    const on = State.savedPosts.has(this._current.id);
    btn.classList.toggle('on', on);
    const short = btn.querySelector('[data-i18n]');
    if (short) short.textContent = I18N.t(on ? 'detail.savedShort' : 'detail.saveShort');
  },

  // opts.focusComment: true khi mở từ nút 💬 trên card feed — cuộn thẳng
  // xuống ô nhập bình luận sau khi modal hiện, đỡ user phải tự cuộn tay.
  //
  // Mở được từ NHIỀU chỗ (feed, UserQuanModal, SavedListModal, deep-link
  // chia sẻ…) — đóng modal đang mở (nếu có) trước khi hiện, cùng lý do
  // và cùng cách xử lý như UserQuanModal.open() ở trên (2 modal cùng
  // z-index sẽ chồng lớp thay vì thay thế đúng nghĩa nếu cùng .show).
  open(r, opts = {}) {
    const prevModal = document.querySelector('.modal-overlay.show:not(#communityDetailModal)');
    this._returnModalId = prevModal ? prevModal.id : null;
    if (prevModal) prevModal.classList.remove('show');

    this._current = r;
    if (typeof Analytics !== 'undefined') Analytics.track('detail_open', {
      source: 'community',
      has_image: !!(r.photos && r.photos.length),
      has_coords: !!(r.location && (r.location.lat !== 0 || r.location.lon !== 0)),
      visibility: r.visibility || '',
    });
    const catKey = COMMUNITY_PB_TO_CAT[r.category] || 'restaurant';
    const cat = CATEGORIES[catKey];
    const priceLabel = COMMUNITY_PRICE_LABEL[r.price_range] || '';
    const visBadge = COMMUNITY_VIS_BADGE[r.visibility] || '';
    const photos = Community.photoUrls(r, '800x1000'); // khung 4:5, xem ghi chú ở communityCardHtml()
    const carousel = photos.length
      ? `<div class="post-carousel" style="border-radius:var(--radius);overflow:hidden;margin-bottom:.7rem">
           <div class="post-carousel-track">${photos.map(url => `<div class="post-photo" style="background-image:url('${escapeHtml(url)}')"></div>`).join('')}</div>
           ${photos.length > 1 ? `<div class="post-dots">${photos.map((_, i) => `<span class="post-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>` : ''}
         </div>`
      : '';
    const tagsHtml = (r.tags || []).map(t => `<span class="comm-r-chip">${escapeHtml(t)}</span>`).join('');
    const hashHtml = (r.hashtags || []).map(h => `<span class="comm-r-chip hashtag">#${escapeHtml(h)}</span>`).join('');
    const author = r.expand && r.expand.created_by;
    const _cu2 = typeof Community !== 'undefined' && Community.currentUser;
    const _isMine2 = _cu2 && (r.created_by === _cu2.id);
    const authorName = (author && author.name) || (_isMine2 && _cu2.name) || I18N.t('common.anonymous');
    const authorId = (author && author.id) || r.created_by || '';
    const addressHtml = r.address ? `<div class="detail-address">${svgIcon('social-home-address')} ${escapeHtml(r.address)}</div>` : '';
    const isOwner = !!(Community.currentUser && (r.created_by === Community.currentUser.id || authorId === Community.currentUser.id));

    const footerHtml = isOwner
      ? `<button class="data-btn" id="cdmEdit">${svgIcon('action-edit')} Sửa</button>
         <button class="my-r-del" id="cdmDelete" title="${I18N.t('myR.delete')}">${svgIcon('action-delete')}</button>`
      : `<button class="post-avatar" type="button" data-user-id="${authorId}" data-user-name="${escapeHtml(authorName)}" style="width:30px;height:30px;font-size:1rem">${authorAvatar(author)}</button>
         <button class="comm-r-author" type="button" data-user-id="${authorId}" data-user-name="${escapeHtml(authorName)}">${escapeHtml(authorName)}</button>
         <div style="margin-left:auto;display:flex;align-items:center;gap:.35rem">
           <button class="heart-btn" data-id="${r.id}"><span class="heart-ico">${svgIcon('heart-outline')}</span></button>
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
      <div id="cdmLinkedGroup"></div>
      <div class="comm-r-footer" style="border-top:1.5px dashed var(--line-2);margin-top:.9rem;padding-top:.7rem">
        ${footerHtml}
      </div>
      <div class="comment-section">
        <div class="comment-section-title">${I18N.t('comment.title')}</div>
        <div class="comment-list" id="cdmCommentList"></div>
        <div class="comment-input-row">
          <input class="comment-input" id="cdmCommentInput" type="text" maxlength="500"
            placeholder="${I18N.t('comment.placeholder')}" autocomplete="off">
          <button class="comment-send-btn" id="cdmCommentSend" type="button">${I18N.t('comment.send')}</button>
        </div>
      </div>
    `;
    const body = document.getElementById('communityDetailBody');
    wireCarousels(body);
    this._loadLinkedGroup(r);
    this._loadComments(r);
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

    this._syncSaveBtn();
    document.getElementById('communityDetailModal').classList.add('show');

    // Ô nhập bình luận đã nằm sẵn trong template tĩnh ở trên (không đợi
    // _loadComments() — danh sách comment có tải chậm thì ô nhập vẫn dùng
    // được ngay). Delay nhỏ để đợi modal slide-up xong mới cuộn, không bị
    // giật giữa lúc animation đang chạy.
    if (opts.focusComment) {
      setTimeout(() => {
        const input = document.getElementById('cdmCommentInput');
        if (!input) return;
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
      }, 350);
    }
  },

  // Truy vấn CHÍNH XÁC toàn bộ nhóm "cùng 1 quán" (kể cả bài không nằm
  // trong danh sách vừa mở modal này từ đâu ra) — 1 lần gọi riêng vì đây
  // là hành động chủ động của người dùng (bấm vào xem hẳn 1 quán), không
  // phải render hàng loạt như feed. Vẫn qua getLinkedGroup() → tôn trọng
  // đúng quyền xem hiện có, không lộ gì thêm.
  async _loadLinkedGroup(r) {
    const slot = document.getElementById('cdmLinkedGroup');
    if (!slot) return;
    const rootId = Community.resolveRootId(r);
    const group = await Community.getLinkedGroup(rootId);
    const others = group.filter(x => x.id !== r.id);
    if (!others.length) { slot.innerHTML = ''; return; }
    const counts = await Promise.all(others.map(x => Community.voteCount(x.id)));
    const mine = await Community.voteCount(r.id);
    const total = mine + counts.reduce((a, b) => a + b, 0);
    slot.innerHTML = `
      <div class="linked-group-box">
        <div class="linked-group-title">${svgIcon('action-invite-link')} ${I18N.t('post.groupTitle', { n: others.length })} · svgIcon('rating-star-filled') ${total}</div>
        <div class="linked-group-list">
          ${others.map(x => {
            const a = x.expand && x.expand.created_by;
            const aName = (a && a.name) || I18N.t('common.anonymous');
            const thumb = Community.thumbnailUrl(x, '120x120');
            return `<button type="button" class="linked-group-item" data-id="${x.id}">
              <span class="linked-group-thumb" style="${thumb ? `background-image:url('${escapeHtml(thumb)}')` : ''}"></span>
              <span class="linked-group-author">${authorAvatar(a)} ${escapeHtml(aName)}</span>
            </button>`;
          }).join('')}
        </div>
      </div>`;
    slot.querySelectorAll('.linked-group-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = others.find(x => x.id === btn.dataset.id);
        if (target) this.open(target);
      });
    });
  },

  // Tải bình luận — CHỈ khi user thực sự mở chi tiết 1 bài, KHÔNG poll
  // real-time (quyết định có chủ đích, xem comment ở js/community.js —
  // tránh thêm 1 vòng poll nữa lên Cloudflare Quick Tunnel vốn đã hay rớt).
  // Muốn thấy bình luận mới của người khác thì đóng mở lại modal.
  async _loadComments(r) {
    const list = document.getElementById('cdmCommentList');
    if (!list) return;
    list.innerHTML = `<div class="comment-loading">${I18N.t('em.loading')}</div>`;
    const res = await Community.listComments(r.id);
    if (this._current !== r) return; // đã đóng/chuyển bài khác trong lúc chờ
    if (!res.ok) { list.innerHTML = `<div class="comment-loading">${I18N.t('comment.loadFail')}</div>`; return; }
    this._renderComments(res.data.items || []);
  },

  _renderComments(items) {
    const list = document.getElementById('cdmCommentList');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = `<div class="comment-empty">${I18N.t('comment.empty')}</div>`;
      return;
    }
    const myId = Community.currentUser && Community.currentUser.id;
    const postOwnerId = this._current && this._current.created_by;
    list.innerHTML = items.map(c => {
      const author = c.expand && c.expand.user;
      const authorName = (author && author.name) || I18N.t('common.anonymous');
      const canDelete = myId && (c.user === myId || postOwnerId === myId);
      return `<div class="comment-row" data-id="${c.id}">
        <div class="comment-avatar">${authorAvatar(author)}</div>
        <div class="comment-body">
          <div class="comment-meta"><span class="comment-author">${escapeHtml(authorName)}</span><span class="comment-time">${timeAgo(c.created)}</span></div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
        </div>
        ${canDelete ? `<button class="comment-del-btn" data-id="${c.id}" title="${I18N.t('common.close')}">${svgIcon('action-close')}</button>` : ''}
      </div>`;
    }).join('');
    list.querySelectorAll('.comment-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(I18N.t('comment.confirmDelete'))) return;
        const res = await Community.deleteComment(btn.dataset.id);
        if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
        showToast(I18N.t('toast.commentDeleted'));
        this._loadComments(this._current);
      });
    });
  },

  async _submitComment() {
    const input = document.getElementById('cdmCommentInput');
    const text = input.value.trim();
    if (!Community.isLoggedIn()) { showToast(I18N.t('toast.commentNeedLogin')); return; }
    if (!text) { showToast(I18N.t('toast.commentEmpty')); return; }
    const btn = document.getElementById('cdmCommentSend');
    btn.disabled = true;
    const res = await Community.createComment(this._current.id, text);
    btn.disabled = false;
    if (!res.ok) { showToast(`⚠️ ${res.error}`); return; }
    input.value = '';
    if (typeof Analytics !== 'undefined') Analytics.track('comment_post', {});
    this._loadComments(this._current);
  },

  close() {
    document.getElementById('communityDetailModal').classList.remove('show');
    if (this._returnModalId) {
      document.getElementById(this._returnModalId)?.classList.add('show');
      this._returnModalId = null;
    }
  },
};

/* ═══════════════════════════════════════════════
   FOLLOWER LIST MODAL — tap the "FOLLOWER" stat in profile hero.
═══════════════════════════════════════════════ */
const FollowerListModal = {
  init() {
    const modal = document.getElementById('followerListModal');
    document.getElementById('followerListClose')?.addEventListener('click', () => this._close());
    modal?.addEventListener('click', (e) => { if (e.target === modal) this._close(); });

    // Delegated click on the profile hero — the stat cards are rendered
    // fresh every _renderMyRestaurants so binding once here catches
    // every re-render without wiring individually.
    const header = document.getElementById('myRProfileHeader');
    if (header) {
      header.addEventListener('click', (e) => {
        const stat = e.target.closest('.social-stat[data-stat="followers"]');
        if (stat) this.open();
      });
    }
  },

  async open() {
    if (!Community.isLoggedIn() || !Community.currentUser) {
      showToast(I18N.t('toast.needLogin'));
      return;
    }
    const modal = document.getElementById('followerListModal');
    const body = document.getElementById('followerListBody');
    const countEl = document.getElementById('followerListCount');
    modal.classList.add('show');
    body.innerHTML = `<div class="list-empty"><div class="list-empty-icon">${svgIcon('status-loading')}</div><div class="list-empty-msg">${I18N.t('em.loading')}</div></div>`;
    countEl.textContent = '···';

    const r = await Community.followerList(Community.currentUser.id);
    if (!r.ok) {
      body.innerHTML = `<div class="list-empty">
        <div class="list-empty-icon">${svgIcon('status-error-face')}</div>
        <div class="list-empty-msg">${I18N.t('em.loadFail')}</div>
        <div class="list-empty-sub">${escapeHtml(r.error || '')}</div>
      </div>`;
      return;
    }
    const items = (r.data && r.data.items) || [];
    countEl.textContent = I18N.t('follower.count', { n: items.length });
    if (!items.length) {
      body.innerHTML = `<div class="list-empty">
        <div class="list-empty-icon">${svgIcon('status-empty-wave')}</div>
        <div class="list-empty-msg">${I18N.t('follower.emptyMsg')}</div>
        <div class="list-empty-sub">${I18N.t('follower.emptySub')}</div>
      </div>`;
      return;
    }
    body.innerHTML = items.map(u => `
      <div class="follower-row" data-user-id="${u.id}" data-user-name="${escapeHtml(u.name || u.email || '')}" role="button" tabindex="0">
        <div class="follower-avatar">${authorAvatar(u)}</div>
        <div class="follower-name">${escapeHtml(u.name || u.email || I18N.t('common.anonymous'))}</div>
      </div>
    `).join('');

    // Tap a follower row → open their UserQuanModal (public quán feed)
    body.querySelectorAll('.follower-row').forEach(row => {
      row.addEventListener('click', () => {
        this._close();
        UserQuanModal.open(row.dataset.userId, row.dataset.userName);
      });
    });
  },

  _close() {
    document.getElementById('followerListModal').classList.remove('show');
  },
};

/* ═══════════════════════════════════════════════
   FOLLOWING LIST MODAL — opened by tapping the "ĐANG THEO DÕI" stat in
   the OWN profile hero only (communityProfileHeaderHtml never renders this
   stat for anyone else's profile — see followingCount comment there).
   Ai mình đang theo dõi là riêng tư: dùng Community.myFriends(), hàm này
   LUÔN đọc friends của Community.currentUser.id, không nhận userId từ bên
   ngoài — nên modal này về nguyên tắc không có đường nào để lộ ra "X đang
   theo dõi ai" cho người khác, kể cả nếu lỡ wire nhầm ở chỗ khác.
═══════════════════════════════════════════════ */
const FollowingListModal = {
  init() {
    const modal = document.getElementById('followingListModal');
    document.getElementById('followingListClose')?.addEventListener('click', () => this._close());
    modal?.addEventListener('click', (e) => { if (e.target === modal) this._close(); });

    const header = document.getElementById('myRProfileHeader');
    if (header) {
      header.addEventListener('click', (e) => {
        const stat = e.target.closest('.social-stat[data-stat="following"]');
        if (stat) this.open();
      });
    }
  },

  async open() {
    if (!Community.isLoggedIn() || !Community.currentUser) {
      showToast(I18N.t('toast.needLogin'));
      return;
    }
    const modal = document.getElementById('followingListModal');
    const body = document.getElementById('followingListBody');
    const countEl = document.getElementById('followingListCount');
    modal.classList.add('show');
    body.innerHTML = `<div class="list-empty"><div class="list-empty-icon">${svgIcon('status-loading')}</div><div class="list-empty-msg">${I18N.t('em.loading')}</div></div>`;
    countEl.textContent = '···';

    const r = await Community.myFriends();
    if (!r.ok) {
      body.innerHTML = `<div class="list-empty">
        <div class="list-empty-icon">${svgIcon('status-error-face')}</div>
        <div class="list-empty-msg">${I18N.t('em.loadFail')}</div>
        <div class="list-empty-sub">${escapeHtml(r.error || '')}</div>
      </div>`;
      return;
    }
    const items = (r.data && r.data.expand && r.data.expand.friends) || [];
    countEl.textContent = I18N.t('following.count', { n: items.length });
    if (!items.length) {
      body.innerHTML = `<div class="list-empty">
        <div class="list-empty-icon">${svgIcon('status-empty-wave')}</div>
        <div class="list-empty-msg">${I18N.t('following.emptyMsg')}</div>
        <div class="list-empty-sub">${I18N.t('following.emptySub')}</div>
      </div>`;
      return;
    }
    body.innerHTML = items.map(u => `
      <div class="follower-row" data-user-id="${u.id}" data-user-name="${escapeHtml(u.name || u.email || '')}" role="button" tabindex="0">
        <div class="follower-avatar">${authorAvatar(u)}</div>
        <div class="follower-name">${escapeHtml(u.name || u.email || I18N.t('common.anonymous'))}</div>
      </div>
    `).join('');

    // Tap a following row → open their UserQuanModal (public quán feed)
    body.querySelectorAll('.follower-row').forEach(row => {
      row.addEventListener('click', () => {
        this._close();
        UserQuanModal.open(row.dataset.userId, row.dataset.userName);
      });
    });
  },

  _close() {
    document.getElementById('followingListModal').classList.remove('show');
  },
};

/* ═══════════════════════════════════════════════
   FRIENDS MODAL — search + manage "Bạn bè"-visibility list. Opened from
   the accountModal's "Bạn bè" row (see ProfileCtrl.init). The actual
   search input/results/list (#friendSearchInput etc.) are wired once by
   CommunityCtrl._initFriendSearch()/_renderFriends() at boot — this modal
   is just the show/hide shell around them, same shape as
   FollowerListModal/FollowingListModal above.
═══════════════════════════════════════════════ */
const FriendsListModal = {
  init() {
    document.getElementById('friendsModalClose')?.addEventListener('click', () => this.close());
    document.getElementById('friendsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'friendsModal') this.close();
    });
  },
  open() {
    document.getElementById('friendsModal').classList.add('show');
    CommunityCtrl._renderFriends();
  },
  // Returns to accountModal (same "settings" sheet the user came from)
  // rather than exiting the whole Cài đặt flow — both modals share the
  // same z-index, so having two .show at once would just stack in DOM
  // order instead of layering correctly; close/reopen avoids that.
  close() {
    document.getElementById('friendsModal').classList.remove('show');
    document.getElementById('accountModal').classList.add('show');
  },
};

/* ═══════════════════════════════════════════════
   SAVED LIST MODAL — bookmarks (localStorage-only, per browser).
   Opened by the 🔖 icon at top-right of the profile screen.
   Rendered as a community-style grid, tap opens CommunityDetailModal.
═══════════════════════════════════════════════ */
const SavedListModal = {
  init() {
    const modal = document.getElementById('savedListModal');
    document.getElementById('savedListBtn')?.addEventListener('click', () => this.open());
    document.getElementById('savedListClose')?.addEventListener('click', () => this._close());
    modal?.addEventListener('click', (e) => { if (e.target === modal) this._close(); });
  },

  async open() {
    const modal = document.getElementById('savedListModal');
    const body = document.getElementById('savedListBody');
    const countEl = document.getElementById('savedListCount');
    const ids = [...State.savedPosts];
    countEl.textContent = I18N.t('saved.count', { n: ids.length });
    modal.classList.add('show');

    if (ids.length === 0) {
      body.innerHTML = `<div class="list-empty">
        <div class="list-empty-icon">${svgIcon('action-bookmark')}</div>
        <div class="list-empty-msg">${I18N.t('saved.emptyMsg')}</div>
        <div class="list-empty-sub">${I18N.t('saved.emptySub')}</div>
      </div>`;
      return;
    }
    body.innerHTML = `<div class="list-empty"><div class="list-empty-icon">${svgIcon('status-loading')}</div><div class="list-empty-msg">${I18N.t('em.loading')}</div></div>`;

    // Fetch each saved record from PocketBase in parallel. Silently
    // drops IDs that 404 (post was deleted by owner after being saved).
    const results = await Promise.all(ids.map(id => Community._fetch(`/api/collections/restaurants/records/${id}?expand=created_by`)));
    const items = results.filter(r => r.ok && r.data).map(r => r.data);

    if (items.length === 0) {
      body.innerHTML = `<div class="list-empty">
        <div class="list-empty-icon">${svgIcon('status-empty-mailbox')}</div>
        <div class="list-empty-msg">${I18N.t('saved.allGoneMsg')}</div>
        <div class="list-empty-sub">${I18N.t('saved.allGoneSub')}</div>
      </div>`;
      return;
    }
    body.innerHTML = `<div class="social-grid">${items.map(x => communityGridCellHtml(x)).join('')}</div>`;
    // Same tap-to-open wiring as the community feed. Close saved-list
    // first so the detail modal isn't stacked on top of it (bug fix
    // 2026-09-11 — nested modals looked broken).
    body.querySelectorAll('.comm-r-card[data-id]').forEach(cardEl => {
      cardEl.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const r = items.find(x => x.id === cardEl.dataset.id);
        if (!r) return;
        this._close();
        CommunityDetailModal.open(r);
      });
    });
  },

  _close() {
    document.getElementById('savedListModal').classList.remove('show');
  },

  // Called on boot when URL has ?q=<pb_id> — fetches that quán and
  // opens CommunityDetailModal so a shared link lands directly on the
  // right modal instead of the app's home page.
  async openFromLink(id) {
    if (!id || typeof Community === 'undefined' || !Community.BASE_URL) return;
    const r = await Community._fetch(`/api/collections/restaurants/records/${id}?expand=created_by`);
    if (r.ok && r.data) CommunityDetailModal.open(r.data);
    else showToast(I18N.t('toast.linkExpired'));
  },
};

/* ═══════════════════════════════════════════════
   USER QUÁN MODAL — every quán 1 người đã đăng mà tôi xem được (rule
   visibility phía server tự lọc: public/friends-nếu-tôi-là-bạn/chính tôi)
═══════════════════════════════════════════════ */
const UserQuanModal = {
  _returnModalId: null,

  init() {
    document.getElementById('userQuanClose').addEventListener('click', () => this.close());
    document.getElementById('userQuanModal').addEventListener('click', (e) => {
      if (e.target.id === 'userQuanModal') this.close();
    });
  },

  async open(userId, userName) {
    // Mở được từ NHIỀU chỗ (card feed, CommunityDetailModal, danh sách
    // follower/following…) — nếu modal đó đang mở thì đóng nó trước, vì
    // mọi .modal-overlay dùng chung z-index nên 2 modal cùng .show sẽ
    // chồng lớp lên nhau (bug đã gặp y hệt ở AccountModal/FriendsListModal,
    // xem comment ở FriendsListModal.close()) thay vì thay thế đúng nghĩa.
    // Nhớ modal đó lại để close() quay về đúng chỗ, không làm gián đoạn flow.
    const prevModal = document.querySelector('.modal-overlay.show:not(#userQuanModal)');
    this._returnModalId = prevModal ? prevModal.id : null;
    if (prevModal) prevModal.classList.remove('show');

    document.getElementById('userQuanTitle').innerHTML = I18N.t('userQuan.title', { name: escapeHtml(userName || I18N.t('common.thisPerson')) });
    const body = document.getElementById('userQuanBody');
    body.innerHTML = `<div class="empty-comm"><div class="em-icon">${svgIcon('status-loading')}</div><div class="em-msg">${I18N.t('em.loading')}</div></div>`;
    document.getElementById('userQuanCount').textContent = '';
    document.getElementById('userQuanModal').classList.add('show');

    // Nút Theo dõi ngay trong profile — không hiện với chính mình.
    const followSlot = document.getElementById('userQuanFollowSlot');
    followSlot.innerHTML = '';
    const isSelf = Community.currentUser && userId === Community.currentUser.id;
    const [userRes, listRes, followerCount, friendsRes] = await Promise.all([
      Community.getUser(userId),
      Community.listRestaurants({ filter: `created_by="${userId}"` }),
      Community.followerCount(userId),
      (Community.currentUser && !isSelf) ? Community.myFriends() : Promise.resolve(null),
    ]);
    if (Community.currentUser && !isSelf) {
      const following = !!(friendsRes && friendsRes.ok && (friendsRes.data.friends || []).includes(userId));
      // userRes.data.friends là danh sách người NGƯỜI NÀY theo dõi — users.viewRule
      // mở cho mọi người đăng nhập (migration 1725700005) nên đọc thẳng field này
      // để biết "họ có theo dõi mình không" mà không cần thêm request nào.
      const theyFollowMe = !!(userRes.ok && (userRes.data.friends || []).includes(Community.currentUser.id));
      followSlot.innerHTML = followBtnHtml(userId, userName || I18N.t('common.thisPerson'), following, theyFollowMe);
      wireFollowButtons(followSlot, () => CommunityCtrl._renderFriends());
    }
    if (!listRes.ok) {
      body.innerHTML = `<div class="empty-comm"><div class="em-icon">${svgIcon('status-error-face')}</div><div class="em-msg">${I18N.t('em.loadFail')}</div></div>`;
      return;
    }
    const items = listRes.data.items;
    const avatar = authorAvatar(userRes.ok ? userRes.data : null);
    const displayName = (userRes.ok && userRes.data.name) || userName || I18N.t('common.thisPerson');
    const starCounts = await Promise.all(items.map(x => Community.voteCount(x.id)));
    const starTotal = starCounts.reduce((a, b) => a + b, 0);

    // followingCount CỐ Ý không truyền — ai người này đang theo dõi là
    // riêng tư, chỉ chính chủ mới xem được (xem communityProfileHeaderHtml).
    const header = communityProfileHeaderHtml({
      avatar, name: displayName, tagline: '',
      postCount: items.length, starCount: starTotal, followerCount,
    });

    if (!items.length) {
      body.innerHTML = header + `<div class="empty-comm"><div class="em-icon">${svgIcon('cat-nhahang')}</div><div class="em-msg">${I18N.t('em.noneVisible')}</div></div>`;
      return;
    }
    body.innerHTML = header + `<div class="social-grid">${items.map(x => communityGridCellHtml(x)).join('')}</div>`;
    wireCardDetail(body, items);
  },

  close() {
    document.getElementById('userQuanModal').classList.remove('show');
    if (this._returnModalId) {
      document.getElementById(this._returnModalId)?.classList.add('show');
      this._returnModalId = null;
    }
  },
};

/* ═══════════════════════════════════════════════
   COMMUNITY ADD RESTAURANT MODAL
═══════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════
   SAVED TRIPS — lộ trình người dùng tự lưu để đi sau.
   Tách hẳn khỏi "Chuyến ăn đã đi" (tripsModal): cái kia là nhật ký tự
   ghi và bị cắt còn 50 mục, cái này có tên và tồn tại tới khi tự xoá.
═══════════════════════════════════════════════ */
const SavedTripsModal = {
  init() {
    document.getElementById('savedTripsBtn')?.addEventListener('click', () => this.open());
    document.getElementById('savedTripsClose')?.addEventListener('click', () => this.close());
    document.getElementById('savedTripsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'savedTripsModal') this.close();
    });
  },

  open() {
    document.getElementById('savedTripsModal').classList.add('show');
    this.render();
  },
  close() { document.getElementById('savedTripsModal').classList.remove('show'); },

  render() {
    const trips = State.savedTrips || [];
    document.getElementById('savedTripsCount').textContent = I18N.t('savedTrip.count', { n: trips.length });
    const body = document.getElementById('savedTripsBody');
    if (!trips.length) {
      body.innerHTML = `
        <div class="list-empty">
          <div class="list-empty-icon">${svgIcon('map-saved-route')}</div>
          <div class="list-empty-msg">${I18N.t('savedTrip.empty')}</div>
          <div class="list-empty-sub">${I18N.t('savedTrip.emptySub')}</div>
        </div>`;
      return;
    }
    body.innerHTML = trips.map(t => {
      const when = new Date(t.at);
      const dateLabel = `${String(when.getDate()).padStart(2,'0')}/${String(when.getMonth()+1).padStart(2,'0')}/${when.getFullYear()}`;
      const stops = (t.stops || []).map((s, i) =>
        `<div class="strip-stop"><b>${i + 1}</b><span>${escapeHtml(s.name)}</span></div>`).join('');
      const origin = t.origin && t.origin.label
        ? `<div class="strip-origin">${svgIcon('action-gps')} ${escapeHtml(t.origin.label)}</div>` : '';
      return `
        <div class="strip-item" data-trip="${t.id}">
          <div class="strip-head"><div class="strip-name">${escapeHtml(t.name)}</div></div>
          <div class="strip-meta">${I18N.t('savedTrip.meta', { n: (t.stops || []).length, date: dateLabel })}</div>
          ${origin}
          <div class="strip-stops">${stops}</div>
          <div class="strip-actions">
            <button type="button" class="strip-go" data-go="${t.id}">${I18N.t('savedTrip.go')}</button>
            <button type="button" class="strip-del" data-del="${t.id}">${I18N.t('savedTrip.delete')}</button>
          </div>
        </div>`;
    }).join('');

    body.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      const trip = (State.savedTrips || []).find(t => String(t.id) === b.dataset.go);
      if (!trip) return;
      this.close();
      PlanCtrl.openSavedTrip(trip);
    }));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const trip = (State.savedTrips || []).find(t => String(t.id) === b.dataset.del);
      if (!trip) return;
      if (!confirm(I18N.t('savedTrip.confirmDelete', { name: trip.name }))) return;
      State.savedTrips = State.savedTrips.filter(t => String(t.id) !== b.dataset.del);
      Storage.save();
      this.render();
      showToast(I18N.t('savedTrip.deleted'));
    }));
  },
};

/* ═══════════════════════════════════════════════
   PHOTO VIEW — xem 1 ảnh cỡ lớn. Dùng khi sửa bài để nhìn rõ ảnh trước
   khi quyết định xoá. Cố ý tối giản: 1 ảnh, không vuốt, không zoom —
   carousel trong bài đã lo phần xem nhiều ảnh rồi.
═══════════════════════════════════════════════ */
const PhotoView = {
  init() {
    const ov = document.getElementById('photoView');
    if (!ov) return;
    ov.addEventListener('click', () => this.close()); // bấm đâu cũng đóng
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !ov.hidden) this.close();
    });
  },
  open(url) {
    const ov = document.getElementById('photoView');
    const img = document.getElementById('photoViewImg');
    if (!ov || !img || !url) return;
    img.src = url;
    ov.hidden = false;
  },
  close() {
    const ov = document.getElementById('photoView');
    if (!ov) return;
    ov.hidden = true;
    // Nhả ảnh để không giữ ảnh gốc (có thể vài MB) trong bộ nhớ.
    document.getElementById('photoViewImg').src = '';
  },
};

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
  _linkedTo: null,       // id gốc nhóm nếu người đăng xác nhận "cùng quán với..."
  _dupCheckTimer: null,

  // ── Bản nháp ────────────────────────────────────────────────────────
  // Form này dài (tên, mô tả, vị trí, thẻ, hashtag, tối đa 4 ảnh) nên
  // lỡ bấm ra ngoài overlay là mất sạch — lý do có draft. Chỉ áp dụng
  // cho ĐĂNG MỚI: sửa quán đã đăng thì bản gốc vẫn nằm trên server.
  DRAFT_KEY: 'community_add_draft',
  DRAFT_TTL: 7 * 24 * 3600 * 1000, // 7 ngày — quá hạn thì coi như bỏ
  _draftTimer: null,
  _openSeq: 0,           // chống race: nạp ảnh nháp xong thì modal đã đổi
  _dbPromise: null,

  init() {
    document.getElementById('cfCatPicker').addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-pick-btn');
      if (!btn) return;
      document.querySelectorAll('#cfCatPicker .cat-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._selectedCat = btn.dataset.cat;
      this._scheduleDraftSave();
    });

    document.getElementById('cfPricePicker').addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-pick-btn');
      if (!btn) return;
      document.querySelectorAll('#cfPricePicker .cat-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._selectedPrice = btn.dataset.price;
      this._scheduleDraftSave();
    });

    document.getElementById('cfVisibilityPicker').addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-pick-btn');
      if (!btn) return;
      document.querySelectorAll('#cfVisibilityPicker .cat-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._selectedVisibility = btn.dataset.vis;
      this._scheduleDraftSave();
    });

    document.getElementById('cfCancel').addEventListener('click', () => this.close());
    document.getElementById('communityAddModal').addEventListener('click', (e) => {
      if (e.target.id === 'communityAddModal') this.close();
    });

    document.getElementById('cfPhotoInput').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = ''; // reset sớm để chọn LẠI cùng file vẫn kích hoạt change
      // Đang sửa quán đã đăng: ảnh phải đi thẳng lên server ngay, giống ⭐
      // và ✕ ở cùng lưới. Gom vào _photoFiles như lúc đăng mới sẽ chẳng bao
      // giờ được gửi đi, vì _save() ở nhánh sửa chỉ PATCH phần chữ.
      if (this._editingId) { this._addPhotosToEdited(files); return; }
      const room = 4 - this._photoFiles.length;
      if (files.length > room) showToast(I18N.t('toast.tooManyPhotos', { room }));
      files.slice(0, room).forEach(f => {
        this._photoFiles.push(f);
        this._photoPreviewUrls.push(URL.createObjectURL(f));
      });
      this._renderPhotoGrid();
      this._saveDraftPhotos();
      this._scheduleDraftSave();
    });

    // Tag/hashtag arrays are mutated in place (never reassigned) so these
    // closures keep working after open() resets the form.
    this._wireChipInput('cfTagInput', 'cfTagList', this._tags, { hashtag: false });
    this._wireChipInput('cfHashtagInput', 'cfHashtagList', this._hashtags, { hashtag: true });

    document.getElementById('cfSave').addEventListener('click', () => this._save());

    LocationPicker.initSearch('cfLocSearch', 'cfLocSuggest', (r) => {
      // Big admin units (district / city / suburb / county / state) return
      // their centroid as coords — dropping a pin there means the quán's
      // "vị trí" ends up in the middle of Hoàn Kiếm, not at the actual
      // address. In that case, DON'T set the marker or _pickedLat/_pickedLng
      // (require tap-on-map for precision), just recenter with a wider
      // zoom so the user sees the district and can tap the exact spot.
      // For actual street/house/road hits, keep the previous behavior.
      const bigAdmin = ['city','county','state','district','suburb','locality','village','hamlet']
        .includes((r._type || '').toLowerCase());
      if (State.communityPickerMap) {
        State.communityPickerMap.setView([r.lat, r.lng], bigAdmin ? 14 : 17);
        if (!bigAdmin) {
          LocationPicker.setMarker('communityPickerMap', 'communityPickerMarker', r.lat, r.lng, this._selectedCat);
        }
      }
      if (bigAdmin) {
        this._pickedLat = null;
        this._pickedLng = null;
        showToast(I18N.t('toast.tapMapForPrecise'), 3000);
      } else {
        this._pickedLat = r.lat;
        this._pickedLng = r.lng;
        // Feedback trực quan: map + marker đã move; toast xác nhận pick
        // đã ghi nhận. KHÔNG cần đè input để user thấy pick thành công.
        showToast(`📍 ${r.name}${r.sub ? ' · ' + r.sub : ''}`, 2000);
      }
      // KHÔNG overwrite cfLocSearch value — user gõ địa chỉ đầy đủ
      // ("10 Phan Chu Trinh, Hoàn Kiếm, Hà Nội" kèm tầng/ngách nếu có)
      // để lưu vào record; ghi đè bằng r.name (thường chỉ housenumber
      // hoặc tên POI) sẽ mất thông tin. Coords + marker là feedback đủ
      // cho pick — text address là "sở hữu" của người dùng.
      Geocoder.hide(document.getElementById('cfLocSuggest'));
      this._scheduleDupCheck();
      this._scheduleDraftSave();
    });

    // Tên hoặc vị trí đổi → quán "gần giống" tìm được trước đó không còn
    // chắc đúng nữa, phải hỏi lại xem có xác nhận trùng hay không.
    document.getElementById('cfName').addEventListener('input', () => {
      this._scheduleDupCheck();
      this._scheduleDraftSave();
    });
    // Mô tả + ô địa chỉ: gõ tay cũng phải vào nháp (địa chỉ có thể được
    // nhập thẳng mà không chọn gợi ý nào — _save() vẫn geocode từ nó).
    document.getElementById('cfDesc').addEventListener('input', () => this._scheduleDraftSave());
    document.getElementById('cfLocSearch').addEventListener('input', () => this._scheduleDraftSave());

    document.getElementById('cfDraftDiscard').addEventListener('click', () => {
      this._clearDraft();
      // Mở lại form từ đầu — nháp vừa xoá nên open() sẽ dựng form trắng,
      // chắc chắn hơn là reset thủ công từng field một.
      this.open();
      showToast(I18N.t('toast.draftDiscarded'));
    });
  },

  // ── Draft: lưu trữ ──────────────────────────────────────────────────
  // Chữ + lựa chọn → localStorage (đồng bộ, không bao giờ mất giữa chừng).
  // Ảnh → IndexedDB, vì File không JSON hoá được, và nhét 4 ảnh dạng
  // base64 vào localStorage thì vượt quota ~5MB ngay.
  _db() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open('nhopnhep_draft', 1); }
      catch (_) { return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
      req.onsuccess = () => resolve(req.result);
    });
    return this._dbPromise;
  },

  // Mọi lỗi IndexedDB (tab ẩn danh, quota, trình duyệt chặn) đều trả null
  // chứ không throw — phần chữ của bản nháp phải sống độc lập với ảnh.
  async _idb(mode, fn) {
    const db = await this._db();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const op = fn(db.transaction('photos', mode).objectStore('photos'));
        if (!op) return resolve(null);
        op.onsuccess = () => resolve(op.result);
        op.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  },

  _draftIsEmpty() {
    const val = (id) => (document.getElementById(id)?.value || '').trim();
    return !val('cfName') && !val('cfDesc') && !val('cfLocSearch')
      && !this._tags.length && !this._hashtags.length
      && !this._photoFiles.length && this._pickedLat == null;
  },

  _scheduleDraftSave() {
    if (this._editingId) return;
    clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => this._saveDraft(), 400);
  },

  _saveDraft() {
    if (this._editingId) return;
    // Form trắng = người dùng chủ động xoá hết → bỏ luôn nháp cũ, chứ
    // không ghi đè bằng 1 bản nháp rỗng rồi lần sau hiện banner vô nghĩa.
    if (this._draftIsEmpty()) { this._clearDraft(); return; }
    try {
      localStorage.setItem(this.DRAFT_KEY, JSON.stringify({
        v: 1,
        at: Date.now(),
        userId: (Community.currentUser && Community.currentUser.id) || '',
        name: document.getElementById('cfName').value,
        desc: document.getElementById('cfDesc').value,
        address: document.getElementById('cfLocSearch')?.value || '',
        lat: this._pickedLat, lng: this._pickedLng,
        cat: this._selectedCat, price: this._selectedPrice, vis: this._selectedVisibility,
        tags: [...this._tags], hashtags: [...this._hashtags],
        thumbIndex: this._thumbIndex,
      }));
    } catch (_) { /* hết quota / chặn storage — nháp chỉ là tiện ích, bỏ qua */ }
  },

  // Tách riêng khỏi _saveDraft(): ghi ảnh chỉ chạy khi tập ảnh thật sự
  // đổi, không chạy theo mỗi phím gõ.
  _saveDraftPhotos() {
    if (this._editingId) return;
    if (!this._photoFiles.length) return this._idb('readwrite', s => s.delete('current'));
    return this._idb('readwrite', s => s.put(this._photoFiles.slice(0, 4), 'current'));
  },

  _loadDraft() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(this.DRAFT_KEY) || 'null'); } catch (_) { return null; }
    if (!d || d.v !== 1 || !d.at) return null;
    if (Date.now() - d.at > this.DRAFT_TTL) { this._clearDraft(); return null; }
    // Máy dùng chung: không bao giờ bày nháp của tài khoản khác ra.
    const uid = (Community.currentUser && Community.currentUser.id) || '';
    if (d.userId && d.userId !== uid) return null;
    return d;
  },

  _clearDraft() {
    try { localStorage.removeItem(this.DRAFT_KEY); } catch (_) {}
    this._idb('readwrite', s => s.delete('current'));
  },

  _applyDraft(d, seq) {
    document.getElementById('cfName').value = d.name || '';
    document.getElementById('cfDesc').value = d.desc || '';
    const loc = document.getElementById('cfLocSearch');
    if (loc) loc.value = d.address || '';
    this._pickedLat = typeof d.lat === 'number' ? d.lat : null;
    this._pickedLng = typeof d.lng === 'number' ? d.lng : null;

    this._selectedCat = d.cat || 'restaurant';
    this._selectedPrice = d.price || 'binh_dan';
    this._selectedVisibility = d.vis || 'public';
    document.querySelectorAll('#cfCatPicker .cat-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === this._selectedCat));
    document.querySelectorAll('#cfPricePicker .cat-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.price === this._selectedPrice));
    document.querySelectorAll('#cfVisibilityPicker .cat-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.vis === this._selectedVisibility));

    this._tags.length = 0; (d.tags || []).forEach(t => this._tags.push(t));
    this._hashtags.length = 0; (d.hashtags || []).forEach(h => this._hashtags.push(h));
    this._renderChipList('cfTagList', this._tags, false);
    this._renderChipList('cfHashtagList', this._hashtags, true);

    const banner = document.getElementById('cfDraftBanner');
    if (banner) banner.classList.remove('hidden');
    this._restoreDraftPhotos(d.thumbIndex || 0, seq);
  },

  async _restoreDraftPhotos(thumbIndex, seq) {
    const files = await this._idb('readonly', s => s.get('current'));
    // Chờ IndexedDB xong thì modal có thể đã đóng, mở lại, hoặc chuyển
    // sang chế độ sửa — lúc đó nhét ảnh nháp vào là sai màn hình.
    if (seq !== this._openSeq || this._editingId) return;
    if (!files || !files.length) return;
    this._photoPreviewUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch(_) {} });
    this._photoFiles.length = 0;
    this._photoPreviewUrls.length = 0;
    files.slice(0, 4).forEach(f => {
      this._photoFiles.push(f);
      this._photoPreviewUrls.push(URL.createObjectURL(f));
    });
    this._thumbIndex = Math.max(0, Math.min(thumbIndex, this._photoFiles.length - 1));
    this._renderPhotoGrid();
  },

  // Debounce 600ms — tránh gọi listRestaurants() (tải hết quán) sau MỖI
  // phím gõ. Chỉ chạy khi đã có cả tên lẫn vị trí, và chỉ khi đăng MỚI
  // (sửa quán có sẵn không cần hỏi lại "có phải cùng quán với chính nó không").
  _scheduleDupCheck() {
    if (this._editingId) return;
    clearTimeout(this._dupCheckTimer);
    this._linkedTo = null;
    const box = document.getElementById('cfDupCheck');
    if (box) box.classList.add('hidden');
    this._dupCheckTimer = setTimeout(() => this._runDupCheck(), 600);
  },

  async _runDupCheck() {
    const name = document.getElementById('cfName').value.trim();
    const box = document.getElementById('cfDupCheck');
    if (!box || !name || this._pickedLat == null || this._pickedLng == null) return;
    const match = await Community.findSimilarNearby(name, this._pickedLat, this._pickedLng, this._editingId);
    if (!match) { box.classList.add('hidden'); return; }
    const author = match.expand && match.expand.created_by;
    const _cu3 = typeof Community !== 'undefined' && Community.currentUser;
    const _isMine3 = _cu3 && (match.created_by === _cu3.id);
    const authorName = (author && author.name) || (_isMine3 && _cu3.name) || I18N.t('common.anonymous');
    const rootId = Community.resolveRootId(match);
    const thumbUrl = Community.thumbnailUrl(match, '160x160');
    box.classList.remove('hidden');
    // Khung "phát hiện có người quen" — cố tình KHÔNG dùng tông đỏ cảnh báo
    // (đã thử, người dùng thấy giống lỗi hệ thống) — dùng avatar + ảnh thật
    // của bài kia để cảm giác giống 1 gợi ý xã hội ("bạn X đã đăng rồi") hơn
    // là 1 cảnh báo trùng lặp.
    box.innerHTML = `
      <div class="dup-check-head">
        ${thumbUrl ? `<span class="dup-check-thumb" style="background-image:url('${escapeHtml(thumbUrl)}')"></span>` : `<span class="dup-check-avatar">${authorAvatar(author)}</span>`}
        <div class="dup-check-text">${I18N.t('addQuan.dupPrompt', { avatar: authorAvatar(author), author: escapeHtml(authorName), name: escapeHtml(match.name) })}</div>
      </div>
      <div class="dup-check-actions">
        <button type="button" class="dup-check-yes" id="cfDupYes">${I18N.t('addQuan.dupYes')}</button>
        <button type="button" class="dup-check-no" id="cfDupNo">${I18N.t('addQuan.dupNo')}</button>
      </div>`;
    document.getElementById('cfDupYes').addEventListener('click', () => {
      this._linkedTo = rootId;
      box.innerHTML = `<div class="dup-check-text dup-check-confirmed">${I18N.t('addQuan.dupConfirmed', { name: escapeHtml(match.name) })}</div>`;
    });
    document.getElementById('cfDupNo').addEventListener('click', () => {
      this._linkedTo = null;
      box.classList.add('hidden');
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
      this._scheduleDraftSave();
    });
  },

  _renderChipList(listId, arr, hashtag) {
    const el = document.getElementById(listId);
    el.innerHTML = arr.map((v, i) => `<span class="chip-tag${hashtag ? ' hashtag' : ''}">${hashtag ? '#' : ''}${escapeHtml(v)}<button type="button" class="chip-tag-remove" data-i="${i}">${svgIcon('action-close')}</button></span>`).join('');
    el.querySelectorAll('.chip-tag-remove').forEach(b => {
      b.addEventListener('click', () => {
        arr.splice(parseInt(b.dataset.i), 1);
        this._renderChipList(listId, arr, hashtag);
        this._scheduleDraftSave();
      });
    });
  },

  // Thêm ảnh cho quán ĐANG SỬA — tải lên ngay, không đợi bấm "Cập nhật".
  async _addPhotosToEdited(files) {
    if (!files.length) return;
    const room = 4 - this._existingPhotos.length;
    if (room <= 0) { showToast(I18N.t('toast.photoFull')); return; }
    if (files.length > room) showToast(I18N.t('toast.tooManyPhotos', { room }));

    const grid = document.getElementById('cfPhotoGrid');
    const addBtn = document.getElementById('cfPhotoAddBtn');
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = '⏳'; }
    // try/finally như ở _save(): nén ảnh có thể ném lỗi, không được để ô
    // thêm ảnh kẹt ở ⏳ vĩnh viễn.
    let r;
    try {
      r = await Community.addPhotos(this._editingId, files, {
        existingCount: this._existingPhotos.length,
        onProgress: (phase, i, total) => {
          if (!addBtn) return;
          addBtn.textContent = phase === 'compress' ? `${i}/${total}` : '📤';
        },
      });
    } catch (e) {
      r = { ok: false, error: (e && e.message) || I18N.t('err.connectionGeneric') };
    } finally {
      if (addBtn) addBtn.disabled = false;
    }

    if (!r.ok) {
      const hint = (r.status === 400 && Community.isLoggedIn()) ? ` — ${I18N.t('err.reloginHint')}` : '';
      showToast(`⚠️ ${r.error}${hint}`, hint ? 5000 : 3000);
      this._renderPhotoGrid(); return;
    }
    this._editingRecord = r.data;
    this._existingPhotos = (r.data.photos || []).map(f => Community.photoUrl(r.data, f, '200x200'));
    this._renderPhotoGrid();
    ProfileCtrl._loadMyRestaurants();
    showToast(I18N.t('toast.photoAdded', { n: (r.data.photos || []).length }));
  },

  _renderPhotoGrid() {
    const grid = document.getElementById('cfPhotoGrid');

    // Chế độ sửa: ảnh đã nằm trên server nên thao tác ở đây tác động NGAY
    // (không chờ bấm "Cập nhật") — bấm ảnh để xem cỡ lớn, ⭐ đổi bìa,
    // ✕ xoá hẳn. Thêm ảnh mới vẫn phải đăng bài mới.
    if (this._editingId) {
      const filenames = this._editingRecord.photos || [];
      // Ô "＋ Thêm ảnh" phải có mặt cả khi quán KHÔNG còn ảnh nào — trước
      // đây chỉ hiện chữ "chưa có ảnh" rồi dừng, nên xoá hết ảnh xong là
      // không còn đường nào thêm lại (người dùng báo đúng chỗ này).
      const addSlotEdit = this._existingPhotos.length < 4
        ? `<button class="photo-slot photo-slot-empty" id="cfPhotoAddBtn" type="button">＋<br><span style="font-size:.65rem">${I18N.t('addQuan.addPhoto')}</span></button>`
        : '';
      if (!this._existingPhotos.length) {
        grid.innerHTML = `<div style="grid-column:span 4;font-size:.78rem;color:var(--text3);margin-bottom:.4rem">${I18N.t('photo.none')}</div>` + addSlotEdit;
        const addBtn0 = document.getElementById('cfPhotoAddBtn');
        if (addBtn0) addBtn0.addEventListener('click', () => document.getElementById('cfPhotoInput').click());
        return;
      }
      grid.innerHTML = this._existingPhotos.map((url, i) => {
        const filename = filenames[i];
        const starActive = filename && filename === this._editingRecord.thumbnail ? ' active' : '';
        return `<div class="photo-slot" style="background-image:url('${url}')" data-view="${escapeHtml(filename)}" title="${I18N.t('photo.tapToView')}">
          <button type="button" class="photo-slot-remove" data-del="${escapeHtml(filename)}" title="${I18N.t('photo.delete')}">${svgIcon('action-close')}</button>
          <button type="button" class="photo-thumb-star${starActive}" data-filename="${escapeHtml(filename)}" title="${I18N.t('photo.setCover')}">${svgIcon('rating-star-cover')}</button>
        </div>`;
      }).join('') + addSlotEdit;

      const addBtnEdit = document.getElementById('cfPhotoAddBtn');
      if (addBtnEdit) addBtnEdit.addEventListener('click', () => document.getElementById('cfPhotoInput').click());

      grid.querySelectorAll('[data-view]').forEach(slot => {
        slot.addEventListener('click', () => {
          // Xem bản to thật (thumb=0x0 = ảnh gốc) — ô trong lưới chỉ 200x200
          // đã cắt vuông, không đủ để chắc chắn mình sắp xoá đúng ảnh nào.
          PhotoView.open(Community.photoUrl(this._editingRecord, slot.dataset.view, '0x0'));
        });
      });

      grid.querySelectorAll('.photo-slot-remove').forEach(b => {
        b.addEventListener('click', async (e) => {
          e.stopPropagation();
          const filename = b.dataset.del;
          // Xoá ảnh trên server là không lấy lại được → phải hỏi, cùng kiểu
          // với xoá cả quán ở tab Cá nhân.
          if (!confirm(I18N.t('photo.confirmDelete'))) return;
          b.disabled = true;
          const r = await Community.deletePhoto(this._editingId, filename);
          b.disabled = false;
          if (!r.ok) { showToast(`⚠️ ${r.error}`); return; }
          this._editingRecord = r.data;
          this._existingPhotos = (r.data.photos || []).map(f => Community.photoUrl(r.data, f, '200x200'));
          this._renderPhotoGrid();
          ProfileCtrl._loadMyRestaurants();
          showToast(I18N.t('toast.photoDeleted'));
        });
      });

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
        <button type="button" class="photo-slot-remove" data-idx="${i}">${svgIcon('action-close')}</button>
        <button type="button" class="photo-thumb-star${starActive}" data-idx="${i}" title="${I18N.t('photo.setCover')}">${svgIcon('rating-star-cover')}</button>
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
        this._saveDraftPhotos();
        this._scheduleDraftSave();
      });
    });
    grid.querySelectorAll('.photo-thumb-star').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this._thumbIndex = parseInt(b.dataset.idx);
        this._renderPhotoGrid();
        this._scheduleDraftSave();
      });
    });
  },

  // record: truyền vào khi sửa quán có sẵn (từ tab Cá nhân); bỏ trống = đăng mới.
  open(record = null) {
    if (!Community.isLoggedIn()) { showToast(I18N.t('toast.needLoginBang')); return; }
    const modal = document.getElementById('communityAddModal');
    modal.classList.add('show');

    const seq = ++this._openSeq; // mốc để phần nạp ảnh nháp biết còn hợp lệ
    clearTimeout(this._draftTimer);
    const draftBanner = document.getElementById('cfDraftBanner');
    if (draftBanner) draftBanner.classList.add('hidden');

    this._editingId = record ? record.id : null;
    this._editingRecord = record;
    document.querySelector('#communityAddModal .modal-title').innerHTML = record
      ? I18N.t('addQuan.editTitle') : I18N.t('addQuan.title');
    document.getElementById('cfSave').innerHTML = record ? I18N.t('addQuan.update') : I18N.t('addQuan.submit');

    document.getElementById('cfName').value = record ? record.name : '';
    document.getElementById('cfDesc').value = record ? (record.description || '') : '';
    this._linkedTo = null;
    clearTimeout(this._dupCheckTimer);
    const dupBox = document.getElementById('cfDupCheck');
    if (dupBox) { dupBox.classList.add('hidden'); dupBox.innerHTML = ''; }
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

    // Đăng mới + có nháp còn hạn → phủ lên form trắng vừa dựng ở trên.
    // Phải đặt sau toàn bộ phần reset, nếu không sẽ bị chính nó xoá lại.
    const draft = record ? null : this._loadDraft();
    if (draft) this._applyDraft(draft, seq);

    // Ghim/căn bản đồ theo _pickedLat/_pickedLng — giá trị này lúc này đã
    // được set từ record (sửa), từ nháp (khôi phục), hoặc null (đăng mới).
    const hasPin = this._pickedLat != null && this._pickedLng != null;
    const center = hasPin
      ? [this._pickedLat, this._pickedLng]
      : [State.userLat || 21.0285, State.userLng || 105.8542];
    setTimeout(() => {
      LocationPicker.initMap('communityPickerMap', 'communityPickerMap', 'communityPickerMarker', center, (lat, lng) => {
        this._pickedLat = lat;
        this._pickedLng = lng;
        LocationPicker.setMarker('communityPickerMap', 'communityPickerMarker', lat, lng, this._selectedCat);
        this._scheduleDupCheck();
        this._scheduleDraftSave();
      });
      if (hasPin) LocationPicker.setMarker('communityPickerMap', 'communityPickerMarker', this._pickedLat, this._pickedLng, this._selectedCat);
    }, 250);
  },

  // saveDraft=false khi đóng vì vừa đăng xong — lúc đó form vẫn còn đầy
  // chữ, lưu lại sẽ thành nháp ma của chính bài vừa đăng.
  close({ saveDraft = true } = {}) {
    // Lưu ngay tại đây, không đợi debounce: đây CHÍNH LÀ lúc người dùng
    // lỡ bấm ra ngoài overlay và cần giữ lại những gì đã nhập.
    clearTimeout(this._draftTimer);
    const keep = saveDraft && !this._editingId && !this._draftIsEmpty();
    if (keep) this._saveDraft();

    document.getElementById('communityAddModal').classList.remove('show');
    this._editingId = null;
    this._editingRecord = null;
    if (keep) showToast(I18N.t('toast.draftSaved'));
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
    const original = btn.innerHTML;

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
      btn.disabled = false; btn.innerHTML = original;
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

    // try/finally là lưới an toàn BẮT BUỘC: trước đây chỉ cần compressImage()
    // ném lỗi (ảnh hỏng / máy hết RAM) là dòng trả nút bên dưới không chạy,
    // nút kẹt "Đang đăng…" mãi mãi và người dùng không nhận được lời giải
    // thích nào. Giờ dù hỏng ở đâu nút cũng luôn bấm lại được.
    let r;
    try {
      r = await Community.createRestaurant({
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
        linkedTo: this._linkedTo,
        // Nén ảnh khoá main thread vài giây với ảnh lớn — nói rõ đang làm gì
        // thay vì để nút đứng im khiến người dùng tưởng máy treo.
        onProgress: (phase, i, total) => {
          btn.textContent = phase === 'compress'
            ? I18N.t('addQuan.compressing', { i, total })
            : I18N.t('addQuan.uploading');
        },
      });
    } catch (e) {
      r = { ok: false, error: (e && e.message) || I18N.t('err.connectionGeneric') };
    } finally {
      btn.disabled = false; btn.innerHTML = original;
    }

    if (!r.ok) {
      // 400 "Failed to create record." thường do token hết hạn — PocketBase
      // coi user là khách, rule @request.auth.id != '' fail → 400 (không phải 401).
      const hint = (r.status === 400 && Community.isLoggedIn())
        ? ` — ${I18N.t('err.reloginHint')}` : '';
      showToast(`⚠️ ${r.error}${hint}`, hint ? 5000 : 3000);
      if (r._pbData) console.warn('[CommunityAdd] PB field errors:', r._pbData);
      return;
    }
    if (typeof Analytics !== 'undefined') Analytics.track('add_quán', {
      cat: this._selectedCat,
      price: this._selectedPrice,
      visibility: this._selectedVisibility,
      photo_count: orderedFiles.length,
      tag_count: this._tags.length,
      hashtag_count: this._hashtags.length,
      has_coords: lat != null && lng != null,
    });
    showToast(I18N.t('toast.postedName', { name }));
    this._clearDraft();
    this.close({ saveDraft: false });
    CommunityCtrl._loadList('');
  },
};


/* ═══════════════════════════════════════════════
   CHECK-IN CONTROLLER — camera-first, "chụp NGAY" real-time capture
   ───────────────────────────────────────────────
   Owns the whole check-in tab lifecycle:

     enter()   — called by TabNav.switchTo('checkin'). Decides which
                 layer to show (signed-out prompt / no-perm fallback /
                 live camera) and calls _startStream() if the user is
                 logged in and the camera is grantable.
     leave()   — called on tab switch away. Stops the MediaStream so
                 the OS camera-in-use indicator doesn't stay lit.
     _tapShutter() — grabs a frame from the <video> onto an offscreen
                 <canvas>, converts to WebP, hands off to the preview
                 sheet. NO gallery fallback here (see rationale below).
     _submit() — sends the compressed Blob + rating/note/toggle through
                 Community.createCheckin().

   Design rationale (short — long form is in the checkins migration
   header): camera capture MUST be live to keep the "verified" premise.
   That's why we intentionally don't offer an <input type="file"> path
   here; if getUserMedia is denied we render #checkinNoPerm with a
   retry button that just calls _startStream() again.

   The nearby-quán auto-detect is best-effort: it uses State.userLat/
   userLng if the Home tab has already got GPS, otherwise falls back
   to the closest saved quán from State (or an OSM/Gemini placeholder
   the user picks manually via the top pill). Never blocks the shutter.
═══════════════════════════════════════════════ */
const CheckinCtrl = {
  _stream: null,
  _facing: 'environment',  // start with rear camera on phones
  _selected: null,         // {id, name, lat, lng, emoji, source}
  _captured: null,         // { blob: Blob, dataUrl: string } — the pending photo
  _pickerCandidates: [],

  init() {
    document.getElementById('checkinQuanPill').addEventListener('click', () => this._openPicker());
    document.getElementById('checkinDiaryBtn').addEventListener('click', () => this._openDiary());
    document.getElementById('checkinFlipBtn').addEventListener('click', () => this._flipCamera());
    document.getElementById('checkinShutterBtn').addEventListener('click', () => this._tapShutter());
    document.getElementById('checkinRetryCam').addEventListener('click', () => this._startStream());
    document.getElementById('checkinGoSignIn').addEventListener('click', () => TabNav.switchTo('community'));

    // Star rating pills — both the live camera pill and the preview pill
    // wire the same way; picking a star sets data-rating on the container.
    ['checkinStars', 'checkinPreviewStars'].forEach(id => {
      const c = document.getElementById(id);
      if (!c) return;
      c.querySelectorAll('.checkin-star').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = +btn.dataset.value;
          const cur = +c.dataset.rating || 0;
          this._setStars(c, cur === v ? 0 : v);
        });
      });
    });

    // Preview sheet controls
    document.getElementById('checkinRetakeBtn').addEventListener('click', () => this._retake());
    document.getElementById('checkinPreviewClose').addEventListener('click', () => this._retake());
    document.getElementById('checkinShareTog').addEventListener('click', () => {
      document.getElementById('checkinShareTog').classList.toggle('on');
    });
    document.getElementById('checkinSendBtn').addEventListener('click', () => this._submit());

    // Quán picker overlay
    const pickerOv = document.getElementById('checkinQuanPickerOverlay');
    pickerOv.addEventListener('click', (e) => { if (e.target === pickerOv) this._closePicker(); });
    document.getElementById('checkinPickerClose').addEventListener('click', () => this._closePicker());

    // Diary overlay
    const diaryOv = document.getElementById('checkinDiaryOverlay');
    diaryOv.addEventListener('click', (e) => { if (e.target === diaryOv) this._closeDiary(); });
    document.getElementById('checkinDiaryClose').addEventListener('click', () => this._closeDiary());

    // Auto-teardown when the tab bar hides this screen. Belt-and-braces:
    // TabNav.switchTo does the .hidden add first, we watch for it to know
    // when to stop the stream (not everywhere calls .leave() explicitly).
    const screen = document.getElementById('checkinScreen');
    new MutationObserver((mutations) => {
      const nowHidden = screen.classList.contains('hidden');
      if (nowHidden && this._stream) this._stopStream();
    }).observe(screen, { attributes: true, attributeFilter: ['class'] });
  },

  // Called by TabNav.switchTo when the check-in tab becomes visible.
  enter() {
    // Reset preview state — the tab always opens ready-to-shoot, never
    // stuck on a stale preview from last visit.
    document.getElementById('checkinPreview').classList.add('hidden');
    this._captured = null;

    if (!Community.isLoggedIn()) {
      document.getElementById('checkinSignInWrap').classList.remove('hidden');
      document.getElementById('checkinNoPerm').classList.add('hidden');
      document.getElementById('checkinVideo').classList.add('hidden');
      this._toggleChrome(false);
      return;
    }

    document.getElementById('checkinSignInWrap').classList.add('hidden');
    this._toggleChrome(true);
    this._refreshQuan();
    this._startStream();
  },

  leave() {
    this._stopStream();
    // Belt-and-braces: if the user swaps tabs mid-preview, put the tab
    // bar back so the destination tab isn't stuck with a hidden bar.
    document.querySelector('.tabbar')?.classList.remove('checkin-hidden');
  },

  // Show/hide the floating controls (pill, cluster, stars, shutter) —
  // hidden when the sign-in overlay or the no-perm fallback is up.
  _toggleChrome(show) {
    ['checkinQuanPill','checkinStars','checkinShutterBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? '' : 'none';
    });
    document.querySelector('#checkinScreen .checkin-cluster').style.display = show ? '' : 'none';
  },

  async _startStream() {
    const video = document.getElementById('checkinVideo');
    const noperm = document.getElementById('checkinNoPerm');
    const showNoperm = (titleKey, subKey, errName) => {
      const tEl = noperm.querySelector('.coming-soon-title');
      const sEl = noperm.querySelector('.coming-soon-sub');
      if (tEl) tEl.textContent = I18N.t(titleKey);
      if (sEl) sEl.textContent = I18N.t(subKey) + (errName ? ` [${errName}]` : '');
      video.classList.add('hidden');
      noperm.classList.remove('hidden');
      this._toggleChrome(false);
    };

    // Feature detection first — old browsers or non-HTTPS pages don't
    // expose mediaDevices at all. Give the user a concrete reason.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      showNoperm(
        isSecure ? 'checkin.noPermTitle' : 'checkin.needHttpsTitle',
        isSecure ? 'checkin.notSupportedSub' : 'checkin.needHttpsSub',
      );
      return;
    }
    // If we already have a stream (e.g. flip), stop it first — the browser
    // rejects two concurrent camera opens on the same device.
    this._stopStream();
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: this._facing } },
        audio: false,
      });
      video.srcObject = this._stream;
      video.classList.remove('hidden');
      noperm.classList.add('hidden');
      this._toggleChrome(true);
    } catch (e) {
      // getUserMedia rejects with different error names — map each to a
      // message that tells the user what to do. Falling back to a single
      // generic message hid the difference between "you denied it" and
      // "no camera exists here", which the user can act on differently.
      const name = (e && e.name) || 'Error';
      console.warn('[checkin] getUserMedia failed:', name, e && e.message || '');
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        // NotAllowedError covers both "user just clicked Block" and the
        // Permissions-Policy header (which produces the same DOMException
        // name, only with a different message). If it's the header case,
        // reloading won't help — but the retry button is still visible
        // in case the user's browser lets them re-prompt.
        showNoperm('checkin.noPermTitle', 'checkin.noPermSub', name);
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        // No camera on the device, or the requested facingMode doesn't
        // match anything available.
        showNoperm('checkin.noCamTitle', 'checkin.noCamSub', name);
      } else if (name === 'NotReadableError' || name === 'AbortError') {
        // Another app has the camera open (Zoom, Instagram, another tab).
        showNoperm('checkin.camBusyTitle', 'checkin.camBusySub', name);
      } else {
        showNoperm('checkin.noPermTitle', 'checkin.noPermSub', name);
      }
    }
  },

  _stopStream() {
    if (this._stream) {
      try { this._stream.getTracks().forEach(t => t.stop()); } catch (_) {}
      this._stream = null;
    }
    const video = document.getElementById('checkinVideo');
    if (video) { try { video.srcObject = null; } catch (_) {} }
  },

  async _flipCamera() {
    this._facing = this._facing === 'environment' ? 'user' : 'environment';
    await this._startStream();
  },

  _refreshQuan() {
    // Auto-pick the closest quán we know about: user's own posts (State
    // has them cached) sorted by distance from State.userLat/userLng.
    // If nothing usable, leave selected=null — user must pick via picker
    // (which prompts them to enter a name for OSM/Gemini spots too).
    if (!this._selected) {
      const closest = this._findClosest();
      if (closest) this._selected = closest;
    }
    const pill = document.getElementById('checkinQuanName');
    const dist = document.getElementById('checkinQuanDist');
    if (this._selected) {
      pill.textContent = this._selected.name;
      dist.textContent = this._selected.dist || '';
    } else {
      pill.textContent = I18N.t('checkin.pickQuan');
      dist.textContent = '';
    }
  },

  _findClosest() {
    const lat = State.userLat, lng = State.userLng;
    const pool = [];
    // Community posts the user has authored (in Profile's list) —
    // ProfileCtrl._loadedList caches these; if not yet loaded, skip.
    const myR = ProfileCtrl && ProfileCtrl._loadedList || [];
    myR.forEach(r => {
      if (r && r.lat != null && r.lng != null) {
        pool.push({
          id: r.id,
          name: r.name,
          lat: r.lat, lng: r.lng,
          emoji: (CATEGORIES[r.category] && CATEGORIES[r.category].icon) ? '' : '',  // svgIcon can't be inlined in emoji field; empty is fine
          source: 'community',
        });
      }
    });
    // Recent scan results (Home tab already fetched them) — good for OSM
    // places the user is currently near.
    (State.results || []).slice(0, 40).forEach(r => {
      if (r && r.lat != null && r.lng != null && r.name) {
        pool.push({
          id: r.id > 1e13 ? '' : (r._pb && r._pb.id) || '',
          name: r.name,
          lat: r.lat, lng: r.lng,
          emoji: '',
          source: r._community ? 'community' : (r._gemini ? 'gemini' : 'osm'),
        });
      }
    });
    if (!pool.length) return null;
    if (lat == null || lng == null) return { ...pool[0], dist: '' };
    // Cheap flat-earth distance — accurate enough at neighborhood scale.
    const withDist = pool.map(p => {
      const dLat = (p.lat - lat) * 111320;
      const dLng = (p.lng - lng) * 111320 * Math.cos(lat * Math.PI / 180);
      const d = Math.round(Math.hypot(dLat, dLng));
      return { ...p, _d: d, dist: d < 1000 ? `${d}m` : `${(d/1000).toFixed(1)}km` };
    });
    withDist.sort((a, b) => a._d - b._d);
    return withDist[0];
  },

  _openPicker() {
    const list = document.getElementById('checkinPickerList');
    const lat = State.userLat, lng = State.userLng;
    // Rebuild the candidate pool same as _findClosest but keep the whole list.
    const pool = [];
    const myR = ProfileCtrl && ProfileCtrl._loadedList || [];
    myR.forEach(r => {
      if (r && r.name) pool.push({ id: r.id, name: r.name, lat: r.lat, lng: r.lng, source: 'community' });
    });
    (State.results || []).slice(0, 40).forEach(r => {
      if (r && r.name) pool.push({
        id: r.id > 1e13 ? '' : ((r._pb && r._pb.id) || ''),
        name: r.name, lat: r.lat, lng: r.lng,
        source: r._community ? 'community' : (r._gemini ? 'gemini' : 'osm'),
      });
    });
    // Dedup by name+source — same quán can appear both in my posts and
    // in the results feed if I scanned my own restaurant.
    const seen = new Set();
    const deduped = pool.filter(p => {
      const k = `${p.name}::${p.source}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    // Distance-sort if we have GPS.
    if (lat != null && lng != null) {
      deduped.forEach(p => {
        if (p.lat != null && p.lng != null) {
          const dLat = (p.lat - lat) * 111320;
          const dLng = (p.lng - lng) * 111320 * Math.cos(lat * Math.PI / 180);
          p._d = Math.round(Math.hypot(dLat, dLng));
          p.dist = p._d < 1000 ? `${p._d}m` : `${(p._d/1000).toFixed(1)}km`;
        } else { p._d = Infinity; p.dist = ''; }
      });
      deduped.sort((a, b) => a._d - b._d);
    }
    this._pickerCandidates = deduped.slice(0, 30);

    if (!this._pickerCandidates.length) {
      list.innerHTML = `<div class="empty" style="text-align:center;padding:1rem;color:var(--text2);font-size:.85rem">${I18N.t('checkin.pickerEmpty')}</div>`;
    } else {
      list.innerHTML = this._pickerCandidates.map((p, i) => `
        <button class="checkin-picker-item" data-idx="${i}" type="button">
          <div class="checkin-picker-body">
            <div class="checkin-picker-name">${escapeHtml(p.name)}</div>
            <div class="checkin-picker-meta">${p.dist ? `<span>${p.dist}</span>` : ''}<span>${p.source === 'community' ? 'Cộng đồng' : (p.source === 'gemini' ? 'AI' : 'OSM')}</span></div>
          </div>
          ${this._selected && this._selected.name === p.name ? '<span class="checkin-picker-tag">Đang chọn</span>' : ''}
        </button>
      `).join('');
      list.querySelectorAll('.checkin-picker-item').forEach(btn => {
        btn.addEventListener('click', () => this._pick(+btn.dataset.idx));
      });
    }
    document.getElementById('checkinQuanPickerOverlay').classList.add('show');
  },

  _closePicker() { document.getElementById('checkinQuanPickerOverlay').classList.remove('show'); },

  _pick(idx) {
    const c = this._pickerCandidates[idx];
    if (!c) return;
    this._selected = c;
    this._refreshQuan();
    this._closePicker();
  },

  _setStars(container, n) {
    container.dataset.rating = n;
    container.querySelectorAll('.checkin-star').forEach(btn => {
      const v = +btn.dataset.value;
      const use = btn.querySelector('use');
      const on = v <= n;
      btn.classList.toggle('on', on);
      if (use) use.setAttribute('href', on ? '#ic-rating-star-filled' : '#ic-rating-star-outline');
    });
  },

  async _tapShutter() {
    // No picker gate — a quán selection is optional now. Snap first,
    // let the user type an address (or skip) in the preview sheet, and
    // fall back to GPS-only. Vỉa hè / spot chưa có tên vẫn check-in được.
    if (!this._stream) { showToast(I18N.t('checkin.noStream')); return; }

    // Flash effect first (feels responsive) then grab the frame async.
    const flash = document.getElementById('checkinFlash');
    flash.classList.add('on');
    setTimeout(() => flash.classList.remove('on'), 150);

    const video = document.getElementById('checkinVideo');
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { showToast(I18N.t('checkin.noStream')); return; }

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    // WebP first (smaller); fall back to JPEG on Safari <14 or when the
    // browser silently returns image/png (canvas.toBlob spec quirk).
    const blob = await new Promise(res => {
      canvas.toBlob(b => {
        if (b && b.type === 'image/webp') return res(b);
        canvas.toBlob(j => res(j), 'image/jpeg', 0.85);
      }, 'image/webp', 0.85);
    });
    if (!blob) { showToast(I18N.t('checkin.captureErr')); return; }

    this._captured = { blob, dataUrl: canvas.toDataURL(blob.type, 0.85) };

    // Wire the preview: copy over the pre-selected rating from the live
    // pill so user isn't asked twice. Default 4 stars if none set.
    const liveR = +document.getElementById('checkinStars').dataset.rating || 0;
    this._setStars(document.getElementById('checkinPreviewStars'), liveR || 4);
    document.getElementById('checkinPreviewPhoto').src = this._captured.dataUrl;
    document.getElementById('checkinCaption').value = '';
    // Prefill address with picked quán name if any — user can edit or clear.
    const addrEl = document.getElementById('checkinAddress');
    if (addrEl) addrEl.value = (this._selected && this._selected.name) || '';
    document.getElementById('checkinShareTog').classList.add('on');
    document.getElementById('checkinPreview').classList.remove('hidden');
    // Slide the floating tab bar off so the Send/toggle/caption strip
    // at bottom:0 isn't covered. Restored in _retake and _submit.
    document.querySelector('.tabbar')?.classList.add('checkin-hidden');
  },

  _retake() {
    document.getElementById('checkinPreview').classList.add('hidden');
    document.querySelector('.tabbar')?.classList.remove('checkin-hidden');
    const addrEl = document.getElementById('checkinAddress');
    if (addrEl) addrEl.value = '';
    this._captured = null;
  },

  async _submit() {
    if (!this._captured) return;
    const btn = document.getElementById('checkinSendBtn');
    const spanEl = btn.querySelector('span[data-i18n]');
    const originalLabel = spanEl ? spanEl.textContent : '';
    btn.disabled = true;
    if (spanEl) spanEl.textContent = I18N.t('checkin.sending');

    const rating = +document.getElementById('checkinPreviewStars').dataset.rating || 0;
    const note = document.getElementById('checkinCaption').value.trim();
    const isShared = document.getElementById('checkinShareTog').classList.contains('on');
    const typedAddr = (document.getElementById('checkinAddress')?.value || '').trim();
    const q = this._selected;

    // Resolve name + coords:
    //  1. Typed address wins (user's override / ad-hoc spot)
    //  2. Picked quán next
    //  3. Anonymous fallback ("Chỗ này") with GPS coords
    let restaurantId = '', restaurantName, restaurantLat, restaurantLng, source;
    if (typedAddr) {
      restaurantName = typedAddr;
      restaurantLat = State.userLat ?? null;
      restaurantLng = State.userLng ?? null;
      source = 'freeform';
    } else if (q) {
      restaurantId = q.source === 'community' && q.id ? q.id : '';
      restaurantName = q.name;
      restaurantLat = q.lat ?? null;
      restaurantLng = q.lng ?? null;
      source = q.source;
    } else {
      restaurantName = I18N.t('checkin.anonSpot');
      restaurantLat = State.userLat ?? null;
      restaurantLng = State.userLng ?? null;
      source = 'anon';
    }

    const r = await Community.createCheckin({
      restaurantId,
      restaurantName,
      restaurantLat,
      restaurantLng,
      restaurantEmoji: '',  // reserved for a future emoji picker
      rating, note, photoBlob: this._captured.blob, isShared,
    });

    btn.disabled = false;
    if (spanEl) spanEl.textContent = originalLabel;

    if (!r.ok) {
      // Surface field-level errors from PocketBase so users (and me
      // debugging remotely) see WHAT failed instead of just the generic
      // "Failed to create record." Empty _pbData on a 400 is the
      // canonical shape of createRule failure — token expired counts.
      let detail = '';
      if (r._pbData && typeof r._pbData === 'object' && Object.keys(r._pbData).length > 0) {
        detail = ' — ' + Object.entries(r._pbData)
          .map(([k, v]) => `${k}: ${(v && (v.message || v.code)) || JSON.stringify(v)}`)
          .join(', ');
      } else if (r.status === 400) {
        detail = ' — ' + I18N.t('err.maybeSessionExpired');
      }
      console.warn('[checkin] createCheckin failed:', r);
      showToast(`⚠️ ${r.error || I18N.t('err.serverGeneric')}${detail}`);
      return;
    }

    if (typeof Analytics !== 'undefined') Analytics.track('checkin', {
      shared: isShared, has_rating: rating > 0, has_note: !!note, source,
    });

    showToast(I18N.t(isShared ? 'checkin.toastShared' : 'checkin.toastPrivate'));

    // Bump the community strip so the poster's own check-in shows up
    // right away — force:true bypasses the 5s debounce inside refresh.
    if (isShared && typeof CheckinFeedCtrl !== 'undefined') {
      CheckinFeedCtrl.refresh({ force: true });
    }
    if (isShared && typeof CheckinDiscoverCtrl !== 'undefined') {
      CheckinDiscoverCtrl.refresh();
    }
    // Always refresh calendar (even private check-ins appear in own calendar).
    if (typeof CheckinCalendarCtrl !== 'undefined') CheckinCalendarCtrl._fetchMonth();

    // Reset for the next check-in
    this._retake();
    this._setStars(document.getElementById('checkinStars'), 0);
  },

  async _openDiary() {
    document.getElementById('checkinDiaryOverlay').classList.add('show');
    if (typeof CheckinCalendarCtrl !== 'undefined') CheckinCalendarCtrl.show();
  },

  _closeDiary() { document.getElementById('checkinDiaryOverlay').classList.remove('show'); },

  _starsRow(n) {
    let out = '';
    for (let i = 1; i <= 5; i++) {
      out += `<svg class="icon" width="12" height="12" style="color:${i<=n?'var(--accent-2)':'var(--text3)'}"><use href="#ic-rating-star-${i<=n?'filled':'outline'}"></use></svg>`;
    }
    return out;
  },
};


/* ═══════════════════════════════════════════════
   CHECK-IN FEED  (v1.2 — 2026-09-22)
   Subtab "Check-in" inside Cộng đồng. Bubbles grouped by user (one
   bubble per user who has any is_shared=true check-in in the last
   24h). Tap a bubble → fullscreen viewer (CheckinViewerCtrl) auto-
   advances through that user's posts, 5s each.

   Refresh triggers: (1) Cộng đồng tab first becomes visible
   (MutationObserver on #communityScreen), (2) user switches to the
   Check-in subtab (handled in CommunityCtrl.init subtab wiring),
   (3) CheckinCtrl._submit() force-refreshes after a shared post so
   the poster's own bubble shows up right away.

   Data path stays cheap: 1 GET to Community.listSharedCheckins()
   (perPage=50, we filter+group client-side). Diary and trang quán
   aggregate still show every check-in full-time — the 24h cutoff
   applies ONLY to this feed.
═══════════════════════════════════════════════ */
const CheckinFeedCtrl = {
  MAX: 50,
  _items: [],   // flat list of records (post-24h filter)
  _groups: [],  // [{user, items[], newestAt, hasFresh}], sorted newest-first
  _lastAt: 0,
  _refreshing: false,

  init() {
    const screen = document.getElementById('communityScreen');
    if (screen) {
      new MutationObserver(() => {
        if (!screen.classList.contains('hidden')) this.refresh();
      }).observe(screen, { attributes: true, attributeFilter: ['class'] });
    }
    if (screen && !screen.classList.contains('hidden')) this.refresh();
  },

  async refresh({ force = false } = {}) {
    if (this._refreshing) return;
    if (!force && Date.now() - this._lastAt < 5000) return;
    this._refreshing = true;
    const bubbles = document.getElementById('checkinBubbles');
    const empty = document.getElementById('checkinBubblesEmpty');
    if (!bubbles || !empty) { this._refreshing = false; return; }

    if (!this._items.length) {
      bubbles.innerHTML = Array.from({length: 4}, () =>
        `<div class="ci-bubble skel">
          <div class="ci-bubble-ring seen"><div class="ci-bubble-inner"></div></div>
          <div class="ci-bubble-name">&nbsp;</div>
        </div>`).join('');
      empty.classList.add('hidden');
    }

    try {
      const r = await Community.listSharedCheckins({ page: 1, perPage: this.MAX });
      this._lastAt = Date.now();
      if (!r.ok) throw new Error(r.error || 'fetch');
      const cutoff = Date.now() - 24 * 3600 * 1000;
      const freshCutoff = Date.now() - 3600 * 1000;
      const all = (r.data && r.data.items) || [];
      this._items = all
        .filter(x => new Date(x.created).getTime() > cutoff)
        .sort((a, b) => new Date(b.created) - new Date(a.created));
      // Group by user. Users with no expand fall into a shared 'anon'
      // bucket so they still render (rare — happens when the users.
      // viewRule blocks expansion for the caller).
      const byUser = new Map();
      for (const it of this._items) {
        const u = (it.expand && it.expand.user) || { id: 'anon', name: I18N.t('common.anonymous') };
        const key = u.id || 'anon';
        if (!byUser.has(key)) byUser.set(key, { user: u, items: [], newestAt: 0, hasFresh: false });
        const g = byUser.get(key);
        g.items.push(it);
        const t = new Date(it.created).getTime();
        if (t > g.newestAt) g.newestAt = t;
        if (t > freshCutoff) g.hasFresh = true;
      }
      this._groups = [...byUser.values()].sort((a, b) => b.newestAt - a.newestAt);
      this._render();
    } catch (e) {
      if (!this._items.length) {
        bubbles.innerHTML = '';
        empty.classList.remove('hidden');
      }
    } finally {
      this._refreshing = false;
    }
  },

  _render() {
    const bubbles = document.getElementById('checkinBubbles');
    const empty = document.getElementById('checkinBubblesEmpty');
    if (!bubbles || !empty) return;
    if (!this._groups.length) {
      bubbles.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    const seen = CheckinViewerCtrl._loadSeen();
    bubbles.innerHTML = this._groups.map((g, gi) => {
      // A group is "seen" only when EVERY post in it has been viewed.
      const allSeen = g.items.every(it => seen.has(it.id));
      // Preview: use the newest post's photo (or emoji fallback) as
      // the inner circle. Avatar isn't used here — the bubble IS
      // the user's identity, name is under it.
      const preview = g.items[0];
      const photoUrl = preview.photo ? Community.checkinPhotoUrl(preview, '160x160') : '';
      const innerStyle = photoUrl
        ? `style="background-image:url('${escapeHtml(photoUrl)}')"` : '';
      const innerClass = 'ci-bubble-inner' + (photoUrl ? ' has-photo' : '');
      const innerContent = photoUrl ? '' : escapeHtml(preview.restaurant_emoji || '🍜');
      const name = (g.user && g.user.name) || I18N.t('common.anonymous');
      const freshDot = g.hasFresh ? `<div class="ci-bubble-fresh" title="Vừa mới"></div>` : '';
      const countBadge = g.items.length > 1
        ? `<div class="ci-bubble-count">${g.items.length}</div>` : '';
      return `<button class="ci-bubble" data-group-idx="${gi}" type="button">
        <div class="ci-bubble-ring${allSeen ? ' seen' : ''}">
          <div class="${innerClass}" ${innerStyle}>${innerContent}</div>
          ${freshDot}
          ${countBadge}
        </div>
        <div class="ci-bubble-name">${escapeHtml(name)}</div>
      </button>`;
    }).join('');

    bubbles.querySelectorAll('.ci-bubble[data-group-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const gi = +el.dataset.groupIdx;
        if (this._groups[gi]) CheckinViewerCtrl.open(this._groups, gi);
      });
    });
  },
};

/* ═══════════════════════════════════════════════
   CHECK-IN DISCOVER  (v1.0 — 2026-09-22)
   Snapchat-Discover-style 2-col grid below the friends bubbles in the
   Cộng đồng → Check-in subtab. Surfaces public check-ins (is_shared=
   true), not just followed users. Deliberately 4 separate honest sorts
   instead of one blended "recommendation score" — each chip maps to
   data that actually exists:
     📍 near — haversine(State.userLat/Lng, restaurant_lat/lng)
     🔥 hot  — count of check-ins clustering at the same spot
     ✨ you  — matches the food emoji the viewer checks into most often
     🕐 new  — server's own -created sort, no client re-sort needed
   No "interaction/likes" sort — likes aren't persisted server-side yet
   (see CheckinPostViewCtrl header), so a chip for it would be fake.
═══════════════════════════════════════════════ */
const CheckinDiscoverCtrl = {
  MAX: 40,
  HOT_MIN: 5,        // spot needs ≥5 check-ins to earn the 🔥 badge
  FRESH_MS: 6 * 3600 * 1000,
  _items: [],
  _popularity: null,  // Map<spotKey, count>
  _myTopEmoji: null,  // null = not loaded yet, '' = loaded but no data
  _sort: 'near',
  _loading: false,

  init() {
    document.querySelectorAll('#ciDiscChips .ci-disc-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#ciDiscChips .ci-disc-chip').forEach(c => c.classList.remove('on'));
        chip.classList.add('on');
        this._sort = chip.dataset.sort;
        this._render();
      });
    });
  },

  async refresh() {
    if (this._loading) return;
    this._loading = true;
    try {
      const r = await Community.listSharedCheckins({ perPage: this.MAX });
      if (r.ok) {
        this._items = (r.data && r.data.items) || [];
        this._buildPopularity();
      }
      if (Community.isLoggedIn() && this._myTopEmoji === null) {
        await this._loadMyTopEmoji();
      }
      this._render();
    } finally {
      this._loading = false;
    }
  },

  _buildPopularity() {
    this._popularity = new Map();
    this._items.forEach(it => {
      const key = this._spotKey(it);
      this._popularity.set(key, (this._popularity.get(key) || 0) + 1);
    });
  },

  // Groups check-ins at "the same place": prefer the community-quán
  // relation id when present (exact), else round lat/lng to ~100m
  // (3 decimals) so nearby GPS jitter still counts as one spot, else
  // fall back to the typed name for vỉa hè spots with no coordinates.
  _spotKey(it) {
    if (it.restaurant) return `id:${it.restaurant}`;
    const lat = it.restaurant_lat != null ? (+it.restaurant_lat).toFixed(3) : '';
    const lng = it.restaurant_lng != null ? (+it.restaurant_lng).toFixed(3) : '';
    if (lat && lng) return `geo:${lat},${lng}`;
    return `name:${(it.restaurant_name || '').trim().toLowerCase()}`;
  },

  async _loadMyTopEmoji() {
    const r = await Community.getMyCheckins({ perPage: 50 });
    this._myTopEmoji = '';
    if (!r.ok) return;
    const items = (r.data && r.data.items) || [];
    const counts = new Map();
    items.forEach(it => { if (it.restaurant_emoji) counts.set(it.restaurant_emoji, (counts.get(it.restaurant_emoji) || 0) + 1); });
    let top = '', max = 0;
    counts.forEach((c, e) => { if (c > max) { max = c; top = e; } });
    this._myTopEmoji = top;
  },

  _distanceOf(it) {
    if (State.userLat == null || State.userLng == null) return Infinity;
    if (it.restaurant_lat == null || it.restaurant_lng == null) return Infinity;
    return haversine(State.userLat, State.userLng, +it.restaurant_lat, +it.restaurant_lng);
  },

  _sortedItems() {
    const items = [...this._items];
    if (this._sort === 'near') {
      items.sort((a, b) => this._distanceOf(a) - this._distanceOf(b));
    } else if (this._sort === 'hot') {
      items.sort((a, b) => (this._popularity.get(this._spotKey(b)) || 0) - (this._popularity.get(this._spotKey(a)) || 0));
    } else if (this._sort === 'you' && this._myTopEmoji) {
      items.sort((a, b) => (b.restaurant_emoji === this._myTopEmoji ? 1 : 0) - (a.restaurant_emoji === this._myTopEmoji ? 1 : 0));
    }
    // 'new' (and 'you' with no history yet): keep the query's own -created order.
    return items;
  },

  _render() {
    const grid = document.getElementById('ciDiscGrid');
    const empty = document.getElementById('ciDiscEmpty');
    if (!grid) return;
    if (!this._items.length) {
      grid.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');

    const items = this._sortedItems();
    grid.innerHTML = items.map((it, i) => {
      const dist = this._distanceOf(it);
      const distLabel = dist === Infinity ? '' : (dist < 1000 ? `${Math.round(dist)}m` : `${(dist / 1000).toFixed(1)}km`);
      const pop = this._popularity?.get(this._spotKey(it)) || 0;
      const photoUrl = it.photo ? Community.checkinPhotoUrl(it, '300x400') : '';
      const author = (it.expand && it.expand.user) || {};
      const authorName = author.name || I18N.t('common.anonymous');
      const isFresh = (Date.now() - new Date(it.created).getTime()) < this.FRESH_MS;

      let badge = '';
      if (pop >= this.HOT_MIN) badge = `<div class="ci-disc-card-badge hot">🔥 ${pop} check-in</div>`;
      else if (isFresh) badge = `<div class="ci-disc-card-badge">🆕 Mới</div>`;
      else if (distLabel) badge = `<div class="ci-disc-card-badge">📍 ${distLabel}</div>`;

      const bg = photoUrl
        ? ` style="background-image:url('${escapeHtml(photoUrl)}');background-size:cover;background-position:center"`
        : '';
      const emoji = photoUrl ? '' : escapeHtml(it.restaurant_emoji || '🍜');
      const meta = [escapeHtml(authorName), distLabel].filter(Boolean).join(' · ');

      return `<div class="ci-disc-card" data-idx="${i}">
        <div class="ci-disc-card-bg"${bg}>${emoji}</div>
        <div class="ci-disc-card-scrim"></div>
        ${badge}
        <div class="ci-disc-card-body">
          <div class="ci-disc-card-name">${escapeHtml(it.restaurant_name || I18N.t('checkin.anonSpot'))}</div>
          <div class="ci-disc-card-meta">${meta}</div>
        </div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.ci-disc-card[data-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const it = items[+el.dataset.idx];
        if (it && typeof CheckinPostViewCtrl !== 'undefined') CheckinPostViewCtrl.open(it);
      });
    });
  },
};

/* ═══════════════════════════════════════════════
   CHECK-IN CALENDAR  (v1.0 — 2026-09-22)
   Locket-style monthly grid inside the Cộng đồng → Check-in subtab.
   Shows the logged-in user's own check-ins grouped by calendar day:
   days with posts → photo thumbnail (or emoji fallback), days without
   → a small dot. Tap a day → opens CheckinViewerCtrl with that day's
   posts. Bottom stat bar: total check-ins + consecutive-day streak.

   Data source: Community._fetch with a month-range filter on the
   `checkins` collection (user + created window). Max 200 records/month
   — realistic ceiling for daily check-ins over 31 days.
═══════════════════════════════════════════════ */
const CheckinCalendarCtrl = {
  _year: 0,
  _month: 0,
  _items: [],
  _byDay: null, // Map<dayNum, record[]>

  init() {
    const now = new Date();
    this._year  = now.getFullYear();
    this._month = now.getMonth() + 1;
    document.getElementById('ciCalPrev')?.addEventListener('click', () => this._shiftMonth(-1));
    document.getElementById('ciCalNext')?.addEventListener('click', () => this._shiftMonth(1));
  },

  async show() {
    await this._fetchMonth();
  },

  async _fetchMonth() {
    if (!Community.isLoggedIn()) return;
    const pad    = n => String(n).padStart(2, '0');
    const lastD  = new Date(this._year, this._month, 0).getDate();
    const start  = `${this._year}-${pad(this._month)}-01 00:00:00`;
    const end    = `${this._year}-${pad(this._month)}-${lastD} 23:59:59`;
    const uid    = Community.currentUser?.id;
    if (!uid) return;
    const filter = encodeURIComponent(`user="${uid}" && created >= "${start}" && created <= "${end}"`);
    const r = await Community._fetch(
      `/api/collections/checkins/records?filter=${filter}&sort=created&perPage=200`
    );
    if (r.ok) this._items = r.data?.items || [];
    this._buildByDay();
    this._render();
  },

  _buildByDay() {
    this._byDay = new Map();
    this._items.forEach(rec => {
      const d = new Date(rec.created).getDate();
      if (!this._byDay.has(d)) this._byDay.set(d, []);
      this._byDay.get(d).push(rec);
    });
  },

  _calcStreak() {
    if (!this._byDay) return 0;
    const now = new Date();
    if (this._year !== now.getFullYear() || this._month !== now.getMonth() + 1) return 0;
    let streak = 0;
    for (let d = now.getDate(); d >= 1; d--) {
      if (this._byDay.has(d)) streak++;
      else break;
    }
    return streak;
  },

  _render() {
    const grid     = document.getElementById('ciCalGrid');
    const monthLbl = document.getElementById('ciCalMonthLbl');
    const nextBtn  = document.getElementById('ciCalNext');
    if (!grid) return;

    const VI_MONTHS = ['tháng 1','tháng 2','tháng 3','tháng 4','tháng 5','tháng 6',
                       'tháng 7','tháng 8','tháng 9','tháng 10','tháng 11','tháng 12'];
    if (monthLbl) monthLbl.textContent = `${VI_MONTHS[this._month - 1]} ${this._year}`;

    const now = new Date();
    const isCurr = this._year === now.getFullYear() && this._month === now.getMonth() + 1;
    if (nextBtn) nextBtn.disabled = isCurr;

    const daysInMonth = new Date(this._year, this._month, 0).getDate();
    const firstDow    = new Date(this._year, this._month - 1, 1).getDay(); // 0=Sun
    const todayDate   = now.getDate();

    let html = '';
    for (let i = 0; i < firstDow; i++) html += '<div></div>';

    for (let d = 1; d <= daysInMonth; d++) {
      const isFuture = isCurr && d > todayDate;
      const isToday  = isCurr && d === todayDate;
      const items    = this._byDay?.get(d);

      if (isFuture) {
        html += '<div></div>';
      } else if (items?.length) {
        const rec      = items[items.length - 1]; // most recent of the day
        const photoUrl = Community.checkinPhotoUrl(rec, '100x100');
        const todayCls = isToday ? ' ci-cal-today' : '';
        const badge    = items.length > 1 ? `<div class="ci-cal-badge">${items.length}</div>` : '';
        if (photoUrl) {
          html += `<div class="ci-cal-cell${todayCls}" data-day="${d}" style="background-image:url('${escapeHtml(photoUrl)}')">${badge}</div>`;
        } else {
          const emoji = escapeHtml(rec.restaurant_emoji || '🍜');
          html += `<div class="ci-cal-cell ci-cal-noimg${todayCls}" data-day="${d}">${emoji}${badge}</div>`;
        }
      } else {
        html += '<div class="ci-cal-empty"><div class="ci-cal-dot"></div></div>';
      }
    }
    grid.innerHTML = html;

    // Tap any filled day → open viewer with that day's posts
    grid.querySelectorAll('.ci-cal-cell[data-day]').forEach(el => {
      el.addEventListener('click', () => {
        const d     = +el.dataset.day;
        const items = this._byDay?.get(d);
        if (!items?.length) return;
        const group = {
          user:     Community.currentUser,
          items,
          newestAt: new Date(items[items.length - 1].created).getTime(),
          hasFresh: false,
        };
        CheckinViewerCtrl.open([group], 0);
      });
    });

    const totalEl  = document.getElementById('ciStatTotal');
    const streakEl = document.getElementById('ciStatStreak');
    if (totalEl)  totalEl.textContent  = this._items.length;
    if (streakEl) streakEl.textContent = this._calcStreak() + 'd';
  },

  _shiftMonth(delta) {
    let m = this._month + delta;
    let y = this._year;
    if (m > 12) { m = 1; y++; }
    if (m < 1)  { m = 12; y--; }
    const now = new Date();
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1)) return;
    this._month = m;
    this._year  = y;
    this._fetchMonth();
  },
};

/* ═══════════════════════════════════════════════
   CHECK-IN POST VIEW MODAL  (v1.1)
   Single-post modal opened when the user taps a card in the strip
   above. Approved layout: 3:5.2 frame · 3:4 photo · header (avatar +
   uppercase username + 📍 location + 🕐 time) + 3 actions (♥ · 🔖 · 🔗).

   v1 note: check-ins have NO like/save backend yet. Buttons persist
   state client-side (localStorage keys ci_liked / ci_saved) so the
   toggle is visible for the user reviewing this UI layer. Wire the
   real endpoints in a follow-up PR — the DOM/CSS stays identical.
═══════════════════════════════════════════════ */
const CheckinPostViewCtrl = {
  LIKES_KEY: 'nhopnhep_ci_liked',
  SAVES_KEY: 'nhopnhep_ci_saved',
  _current: null,
  _liked: null, _saved: null,

  init() {
    this._liked = this._loadSet(this.LIKES_KEY);
    this._saved = this._loadSet(this.SAVES_KEY);

    const ov = document.getElementById('checkinPostOverlay');
    if (!ov) return;
    // Backdrop / close button — mirrors the diary overlay wiring at
    // controllers.js:5270-5272 exactly, so behaviour is consistent.
    ov.addEventListener('click', (e) => { if (e.target === ov) this.close(); });
    document.getElementById('checkinPostClose').addEventListener('click', () => this.close());

    document.getElementById('ciPostLikeBtn').addEventListener('click', () => this._toggleLike());
    document.getElementById('ciPostSaveBtn').addEventListener('click', () => this._toggleSave());
    document.getElementById('ciPostShareBtn').addEventListener('click', () => this._share());
    document.getElementById('ciPostDirectBtn').addEventListener('click', () => this._directions());
  },

  open(record) {
    if (!record) return;
    this._current = record;
    const author = record.expand && record.expand.user;
    const authorName = (author && author.name) || I18N.t('common.anonymous');

    document.getElementById('ciPostUsername').textContent = authorName;
    document.getElementById('ciPostLoc').textContent = record.restaurant_name || '—';
    document.getElementById('ciPostTime').textContent = timeAgo(record.created);

    // Avatar — reuse the app's avatarIcon() via authorAvatar() so it
    // matches whatever icon the user picked in ProfileCtrl.
    const av = document.getElementById('ciPostAvatar');
    av.innerHTML = author && typeof authorAvatar === 'function' ? authorAvatar(author) : (record.restaurant_emoji || '🦊');

    // Photo — falls back to emoji when the check-in was posted without
    // one (allowed by the backend schema, see checkins migration).
    const photoEl = document.getElementById('ciPostPhoto');
    const photoUrl = record.photo ? Community.checkinPhotoUrl(record, '640x800') : '';
    if (photoUrl) {
      photoEl.className = 'ci-post-photo';
      photoEl.style.backgroundImage = "url('" + photoUrl.replace(/'/g, "\\'") + "')";
      photoEl.textContent = '';
    } else {
      photoEl.className = 'ci-post-photo empty';
      photoEl.style.backgroundImage = '';
      photoEl.textContent = record.restaurant_emoji || '🍜';
    }

    // Sync like/save state from localStorage
    document.getElementById('ciPostLikeBtn').classList.toggle('on', this._liked.has(record.id));
    document.getElementById('ciPostLikeIco').innerHTML = this._liked.has(record.id)
      ? '<use href="#ic-heart-filled"></use>' : '<use href="#ic-heart-outline"></use>';
    document.getElementById('ciPostSaveBtn').classList.toggle('on', this._saved.has(record.id));

    // "Đi tới" chip — only meaningful when we have coords OR a real name
    // to search on. Hides on the "Chỗ này" anonymous fallback since a
    // Google Maps search for that literal string returns nothing useful.
    const anonName = I18N.t('checkin.anonSpot');
    const hasCoords = record.restaurant_lat != null && record.restaurant_lng != null;
    const hasRealName = record.restaurant_name && record.restaurant_name !== anonName;
    document.getElementById('ciPostDirectBtn').classList.toggle('hidden', !hasCoords && !hasRealName);

    document.getElementById('checkinPostOverlay').classList.add('show');
  },

  close() {
    document.getElementById('checkinPostOverlay').classList.remove('show');
    this._current = null;
  },

  _toggleLike() {
    if (!this._current) return;
    const id = this._current.id;
    const on = !this._liked.has(id);
    if (on) this._liked.add(id); else this._liked.delete(id);
    this._saveSet(this.LIKES_KEY, this._liked);
    document.getElementById('ciPostLikeBtn').classList.toggle('on', on);
    document.getElementById('ciPostLikeIco').innerHTML = on
      ? '<use href="#ic-heart-filled"></use>' : '<use href="#ic-heart-outline"></use>';
  },

  _toggleSave() {
    if (!this._current) return;
    const id = this._current.id;
    const on = !this._saved.has(id);
    if (on) this._saved.add(id); else this._saved.delete(id);
    this._saveSet(this.SAVES_KEY, this._saved);
    document.getElementById('ciPostSaveBtn').classList.toggle('on', on);
    showToast(I18N.t(on ? 'toast.postSaved' : 'toast.postUnsaved'));
  },

  _directions() {
    const r = this._current;
    if (!r) return;
    this.close();
    showCheckinItinerary(r);
  },

  async _share() {
    if (!this._current) return;
    // Deep-link handler for ?checkin=<id> is not wired yet — plain link
    // still opens the app; CheckinFeedCtrl re-fetches on tab open so the
    // recipient sees the post appear in the strip.
    const url = location.origin + '/?checkin=' + encodeURIComponent(this._current.id);
    try {
      await navigator.clipboard.writeText(url);
      showToast(I18N.t('toast.linkCopied'));
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); showToast(I18N.t('toast.linkCopied')); }
      catch (_) { showToast(I18N.t('toast.linkCopyFail')); }
      document.body.removeChild(ta);
    }
  },

  _loadSet(key) {
    try {
      const raw = localStorage.getItem(key);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (_) { return new Set(); }
  },
  _saveSet(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch (_) {}
  },
};


/* ═══════════════════════════════════════════════
   "Đi tới" — open the itinerary planner with the check-in as sole stop
   Instead of opening an external map, feed the check-in's coords into
   PlanCtrl.buildItinerary() and show the plan screen. User gets the
   app's own route drawn from their current GPS to the quán — same UI
   as replayTrip / a fresh planned trip, so "Save trip" and the map's
   turn-by-turn tracking all work out of the box. Back button returns
   to Cộng đồng (see PlanCtrl.init back handler).
═══════════════════════════════════════════════ */
function showCheckinItinerary(rec) {
  if (!rec) return;
  if (rec.restaurant_lat == null || rec.restaurant_lng == null) {
    showToast(I18N.t('checkinFeed.noCoords'));
    return;
  }
  if (State.userLat == null || State.userLng == null) {
    // No origin → we can't compute a route. Nudge user to enable GPS
    // (Home tab has the button + toast for that flow already).
    showToast(I18N.t('trips.needGps'));
    return;
  }
  // Adapter — match the shape trip.stops uses in replayTrip so the
  // downstream renderers (timeline, map, save-trip) treat this the
  // same as any other planned stop. `cat` MUST be a valid CATEGORIES
  // key; use 'restaurant' as a safe default (dwell = 60min).
  const stop = {
    id: 'checkin-' + (rec.id || Date.now()),
    name: (rec.restaurant_name && rec.restaurant_name.trim()) || I18N.t('checkin.anonSpot'),
    cat: 'restaurant',
    // Timeline renders `${cat.label} · ${stop.price}` raw (see
    // PlanCtrl._renderTimeline). Normal stops carry a display-ready
    // string like "80k–200k"; we don't know that for a check-in, so
    // "—" is a safe placeholder rather than a stray "binh_dan" token.
    price: '—',
    address: rec.restaurant_name || '',
    lat: +rec.restaurant_lat,
    lng: +rec.restaurant_lng,
  };
  PlanCtrl._returnTo = 'community';
  PlanCtrl.buildItinerary([stop]);
  // TabNav.switchTo('home') first so every other screen (including
  // #checkinScreen — which PlanCtrl.show() doesn't hide) is properly
  // hidden. show() then flips home → plan on top of a clean state.
  TabNav.switchTo('home');
  PlanCtrl.show();
}


/* ═══════════════════════════════════════════════
   CHECK-IN VIEWER  (v1.2 — 2026-09-22)
   Fullscreen Stories-style viewer for the Cộng đồng → Check-in subtab.
   Opens with a group of one user's posts (from CheckinFeedCtrl._groups),
   auto-advances 5s/post, progress bar segments up top, tap-left/right
   to navigate. On finish (or tap next past the last post), closes back
   to the bubbles grid.

   State model:
     _groups[] : all groups (users) in the current view — same array
                 CheckinFeedCtrl rendered
     _gi       : current group index
     _pi       : current post index within that group
     _timer    : setTimeout handle for auto-advance
     _seen     : Set of check-in IDs already viewed (localStorage-backed;
                 drives the bubble ring "seen" gray-vs-gradient state)

   No swipe gestures in v1 — tap the left third to go back, tap
   anywhere else to go forward. That's IG Stories' default too, and
   works cleanly without a gesture handler.
═══════════════════════════════════════════════ */
const CheckinViewerCtrl = {
  DURATION_MS: 5000,
  SEEN_KEY: 'nhopnhep_ci_seen',
  _groups: null, _gi: 0, _pi: 0,
  _timer: null,
  _seen: null,

  init() {
    this._seen = this._loadSeen();
    const ov = document.getElementById('checkinViewer');
    if (!ov) return;
    // Backdrop tap → close (only when the tap lands on the backdrop
    // itself, not the frame). Escape hatch for accidental opens.
    ov.addEventListener('click', (e) => { if (e.target === ov) this.close(); });
    document.getElementById('ciViewerClose').addEventListener('click', () => this.close());
    document.getElementById('ciViewerNextZone').addEventListener('click', () => this._next());
    document.getElementById('ciViewerPrevZone').addEventListener('click', () => this._prev());
    document.getElementById('ciViewerDirectBtn').addEventListener('click', () => this._directions());
    document.getElementById('ciViewerLikeBtn').addEventListener('click', () => this._toggleLike());
    document.getElementById('ciViewerSaveBtn').addEventListener('click', () => this._toggleSave());
    document.getElementById('ciViewerShareBtn').addEventListener('click', () => this._share());
  },

  open(groups, gi = 0) {
    if (!groups || !groups[gi]) return;
    this._groups = groups;
    this._gi = gi;
    this._pi = 0;
    document.getElementById('checkinViewer').classList.add('show');
    // Hide the floating tab bar while the viewer takes the whole screen.
    document.querySelector('.tabbar')?.classList.add('checkin-hidden');
    this._renderPost();
  },

  close() {
    document.getElementById('checkinViewer').classList.remove('show');
    document.querySelector('.tabbar')?.classList.remove('checkin-hidden');
    clearTimeout(this._timer); this._timer = null;
    this._groups = null;
    // Re-render bubbles so newly-seen groups turn gray.
    if (typeof CheckinFeedCtrl !== 'undefined') CheckinFeedCtrl._render();
  },

  _current() {
    const g = this._groups && this._groups[this._gi];
    if (!g) return null;
    return g.items[this._pi];
  },

  _renderPost() {
    const g = this._groups && this._groups[this._gi];
    const rec = this._current();
    if (!g || !rec) { this.close(); return; }

    // Progress bar — 1 segment per post in this group. Rebuild every
    // render so the CSS animation restarts cleanly (removing and re-
    // adding the .active class doesn't reliably restart @keyframes).
    const prog = document.getElementById('ciViewerProgress');
    prog.innerHTML = g.items.map((_, i) => {
      const cls = i < this._pi ? 'done' : (i === this._pi ? 'active' : '');
      return `<div class="ci-viewer-progress-seg ${cls}">
        <div class="ci-viewer-progress-seg-fill"></div>
      </div>`;
    }).join('');

    // Header — avatar (uses avatarIcon() like everything else), name, time
    const author = rec.expand && rec.expand.user;
    const avEl = document.getElementById('ciViewerAvatar');
    avEl.innerHTML = author && typeof authorAvatar === 'function'
      ? authorAvatar(author) : (rec.restaurant_emoji || '🦊');
    document.getElementById('ciViewerUsername').textContent =
      (author && author.name) || I18N.t('common.anonymous');
    document.getElementById('ciViewerTime').textContent = timeAgo(rec.created);

    // Photo — fill background of .ci-viewer-photo; falls back to emoji
    // background when the record has no photo (still valid per schema).
    const photoEl = document.getElementById('ciViewerPhoto');
    const photoUrl = rec.photo ? Community.checkinPhotoUrl(rec, '900x1200') : '';
    if (photoUrl) {
      photoEl.className = 'ci-viewer-photo';
      photoEl.style.backgroundImage = "url('" + photoUrl.replace(/'/g, "\\'") + "')";
      photoEl.textContent = '';
    } else {
      photoEl.className = 'ci-viewer-photo empty';
      photoEl.style.backgroundImage = '';
      photoEl.textContent = rec.restaurant_emoji || '🍜';
    }

    // Footer — location + "Đi tới" chip (hide on anon fallback) + actions.
    document.getElementById('ciViewerLoc').textContent = rec.restaurant_name || '—';
    const anonName = I18N.t('checkin.anonSpot');
    const hasCoords = rec.restaurant_lat != null && rec.restaurant_lng != null;
    const hasRealName = rec.restaurant_name && rec.restaurant_name !== anonName;
    document.getElementById('ciViewerDirectBtn').classList.toggle('hidden', !hasCoords && !hasRealName);

    // Like / save state — reuse the same localStorage sets the modal uses.
    const liked = CheckinPostViewCtrl._liked;
    const saved = CheckinPostViewCtrl._saved;
    const likeBtn = document.getElementById('ciViewerLikeBtn');
    likeBtn.classList.toggle('on', liked && liked.has(rec.id));
    document.getElementById('ciViewerLikeIco').innerHTML = liked && liked.has(rec.id)
      ? '<use href="#ic-heart-filled"></use>' : '<use href="#ic-heart-outline"></use>';
    document.getElementById('ciViewerSaveBtn').classList.toggle('on', saved && saved.has(rec.id));

    // Mark this record as seen (drives the bubble ring gray state on
    // re-render). Doesn't affect this render — only the next bubbles pass.
    this._seen.add(rec.id);
    this._saveSeen();

    // Kick auto-advance
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._next(), this.DURATION_MS);
  },

  _next() {
    if (!this._groups) return;
    const g = this._groups[this._gi];
    if (!g) { this.close(); return; }
    if (this._pi < g.items.length - 1) {
      this._pi++;
      this._renderPost();
      return;
    }
    // Last post in this group — advance to next group, or close.
    if (this._gi < this._groups.length - 1) {
      this._gi++;
      this._pi = 0;
      this._renderPost();
    } else {
      this.close();
    }
  },

  _prev() {
    if (!this._groups) return;
    if (this._pi > 0) { this._pi--; this._renderPost(); return; }
    // First post in this group — go back one group's LAST post.
    if (this._gi > 0) {
      this._gi--;
      const prev = this._groups[this._gi];
      this._pi = Math.max(0, prev.items.length - 1);
      this._renderPost();
    } else {
      // Already at the very first post; just restart the timer.
      this._renderPost();
    }
  },

  _directions() {
    const rec = this._current();
    if (!rec) return;
    clearTimeout(this._timer);
    this.close();
    showCheckinItinerary(rec);
  },

  _toggleLike() {
    const rec = this._current();
    if (!rec) return;
    // Delegate to the modal's like set so state stays consistent
    // between the two entry points (modal + viewer).
    const on = !CheckinPostViewCtrl._liked.has(rec.id);
    if (on) CheckinPostViewCtrl._liked.add(rec.id); else CheckinPostViewCtrl._liked.delete(rec.id);
    CheckinPostViewCtrl._saveSet(CheckinPostViewCtrl.LIKES_KEY, CheckinPostViewCtrl._liked);
    document.getElementById('ciViewerLikeBtn').classList.toggle('on', on);
    document.getElementById('ciViewerLikeIco').innerHTML = on
      ? '<use href="#ic-heart-filled"></use>' : '<use href="#ic-heart-outline"></use>';
  },

  _toggleSave() {
    const rec = this._current();
    if (!rec) return;
    const on = !CheckinPostViewCtrl._saved.has(rec.id);
    if (on) CheckinPostViewCtrl._saved.add(rec.id); else CheckinPostViewCtrl._saved.delete(rec.id);
    CheckinPostViewCtrl._saveSet(CheckinPostViewCtrl.SAVES_KEY, CheckinPostViewCtrl._saved);
    document.getElementById('ciViewerSaveBtn').classList.toggle('on', on);
    showToast(I18N.t(on ? 'toast.postSaved' : 'toast.postUnsaved'));
  },

  async _share() {
    const rec = this._current();
    if (!rec) return;
    const url = location.origin + '/?checkin=' + encodeURIComponent(rec.id);
    try {
      await navigator.clipboard.writeText(url);
      showToast(I18N.t('toast.linkCopied'));
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); showToast(I18N.t('toast.linkCopied')); }
      catch (_) { showToast(I18N.t('toast.linkCopyFail')); }
      document.body.removeChild(ta);
    }
  },

  _loadSeen() {
    try {
      const raw = localStorage.getItem(this.SEEN_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (_) { return new Set(); }
  },
  _saveSeen() {
    try {
      // Cap the stored set at 500 entries — bubbles turn gray for any
      // check-in the user has seen in the last day, and old entries
      // aging out of the 24h window are irrelevant, so an unbounded
      // set is just waste. Take the newest 500 by insertion order.
      const arr = [...this._seen];
      const trimmed = arr.length > 500 ? arr.slice(arr.length - 500) : arr;
      localStorage.setItem(this.SEEN_KEY, JSON.stringify(trimmed));
    } catch (_) {}
  },
};
