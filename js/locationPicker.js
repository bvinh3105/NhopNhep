/* ═══════════════════════════════════════════════
   LOCATION PICKER — shared "chọn vị trí trên bản đồ" behavior
   Originally pulled out because two add-flows (a local-only "Quán của tôi"
   modal, since removed, and CommunityAddModal) both needed an address-
   autocomplete input that drops a marker on a small Leaflet map, plus
   tap-to-place on the map itself. Kept as its own module so a future
   add/edit flow (or a second picker on screen at once) is one call away,
   not another copy-paste.
═══════════════════════════════════════════════ */
const LocationPicker = {
  // Wires <input id=inputId> + <div id=suggestId> (Geocoder-style dropdown).
  // onPick(result) is called both on suggestion click and on Enter.
  //
  // opts.hidePoiOnAddress (default false):
  //   When true, if the user's query parses to an address that includes a
  //   housenumber (e.g. "10 Phan Chu Trinh"), hide POI-typed results in
  //   the dropdown so tapping doesn't land on "Highlands Coffee, 10 Phan
  //   Chu Trinh" when they wanted the actual building. Never hides if the
  //   filter would leave the list empty (better to show POIs than nothing).
  //   Off by default so CommunityAddModal can still add POIs by name.
  initSearch(inputId, suggestId, onPick, opts = {}) {
    const hidePoiOnAddress = !!opts.hidePoiOnAddress;
    const input = document.getElementById(inputId);
    const suggest = document.getElementById(suggestId);
    if (!input || !suggest) return;
    DropdownPosition.register(input, suggest);
    const reposition = () => DropdownPosition.reposition(input, suggest);

    const bias = () => ({ nearLat: State.userLat, nearLng: State.userLng });

    // Apply POI hide only when the query has a housenumber (per product spec).
    const filterForRender = (q, results) => {
      if (!hidePoiOnAddress) return results;
      const parsed = Geocoder.parseAddress(q);
      if (!parsed.housenumber) return results;
      const addressOnly = results.filter(r => Geocoder.isAddressType(r));
      return addressOnly.length ? addressOnly : results;
    };

    input.addEventListener('input', (e) => {
      // Vietnamese IME (Telex/VNI) emits input events mid-composition, so
      // "Hà" is seen as h, ha, ha`, hà across ~4 fires. Firing the geocoder
      // on those intermediates wastes requests and shows garbled "no
      // results" to the user before they finish typing. Skip until IME
      // commits — a final 'input' event fires with isComposing=false.
      if (e.isComposing) return;
      const q = e.target.value.trim();
      if (q.length < 3) { Geocoder.hide(suggest); return; }
      reposition();
      Geocoder.showLoading(suggest);
      Geocoder.onInput(inputId, q, 450, (results) => {
        reposition();
        Geocoder.renderSuggestions(suggest, filterForRender(q, results), onPick);
      }, bias());
    });
    // Some IMEs fire the final commit as 'compositionend' without a
    // trailing 'input'. Re-run the search from there so committed VN text
    // never gets stuck waiting for a keystroke that never comes.
    input.addEventListener('compositionend', () => {
      const q = input.value.trim();
      if (q.length < 3) { Geocoder.hide(suggest); return; }
      reposition();
      Geocoder.showLoading(suggest);
      Geocoder.onInput(inputId, q, 450, (results) => {
        reposition();
        Geocoder.renderSuggestions(suggest, filterForRender(q, results), onPick);
      }, bias());
    });

    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      reposition();
      Geocoder.showLoading(suggest);
      const results = await Geocoder.search(q, bias());
      reposition();
      // Keyboard-pick uses the same filter so Enter matches what the user sees.
      // Address-shaped hits first so Enter doesn't land on a nearby
      // landmark POI when the user typed an actual address.
      const filtered = filterForRender(q, results);
      const addressFirst = filtered.filter(r => Geocoder.isAddressType(r));
      const pool = addressFirst.length ? addressFirst : filtered;
      if (pool.length) onPick(pool[0]);
      else Geocoder.renderSuggestions(suggest, [], onPick);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${suggestId}`)) {
        Geocoder.hide(suggest);
      }
    });
  },

  // (Re)creates a bare picker map in divId, stored at State[stateMapKey].
  // onMapClick(lat, lng) fires on tap — caller decides what marker to drop
  // (via setMarker below) since the marker icon depends on category color.
  initMap(divId, stateMapKey, stateMarkerKey, center, onMapClick) {
    if (State[stateMapKey]) { try { State[stateMapKey].remove(); } catch(_) {} State[stateMapKey] = null; }
    if (State[stateMarkerKey]) { try { State[stateMarkerKey].remove(); } catch(_) {} State[stateMarkerKey] = null; }
    State[stateMapKey] = L.map(divId, { center, zoom: 15, zoomControl: false, attributionControl: false, rotateControl: false });
    TileLayer.add(State[stateMapKey]);
    State[stateMapKey].on('click', e => onMapClick(e.latlng.lat, e.latlng.lng));
  },

  setMarker(stateMapKey, stateMarkerKey, lat, lng, catKey) {
    if (State[stateMarkerKey]) State[stateMarkerKey].remove();
    const cat = CATEGORIES[catKey];
    const icon = L.divIcon({
      html: `<div class="r-map-marker" style="background:${cat.color};font-size:1.05rem">${cat.icon}</div>`,
      iconSize: [32, 32], iconAnchor: [16, 16], className: '',
    });
    State[stateMarkerKey] = L.marker([lat, lng], { icon }).addTo(State[stateMapKey]);
  },

  teardownMap(stateMapKey) {
    if (State[stateMapKey]) { try { State[stateMapKey].remove(); } catch(_) {} State[stateMapKey] = null; }
  },

  // Same one-pass geocode-fallback used by both modals' save handlers: if
  // the user typed an address but never tapped the map/picked a suggestion,
  // try to resolve it once before giving up and saving without coordinates.
  async geocodeFallback(addressText) {
    if (!addressText || addressText.length < 3) return null;
    try {
      const bias = { nearLat: State.userLat, nearLng: State.userLng };
      const results = await Geocoder.search(addressText, bias);
      const addressOnly = (results || []).filter(r => Geocoder.isAddressType(r));
      const top = (addressOnly.length ? addressOnly : results)[0];
      return top ? { lat: top.lat, lng: top.lng } : null;
    } catch (e) {
      console.warn('[LocationPicker] geocode error:', e);
      return null;
    }
  },
};
