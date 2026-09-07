/* ═══════════════════════════════════════════════
   LOCATION PICKER — shared "chọn vị trí trên bản đồ" behavior
   AddModal ("Quán của tôi") and CommunityAddModal ("Đăng quán cộng đồng")
   both need the same thing: an address-autocomplete input that drops a
   marker on a small Leaflet map, plus tap-to-place on the map itself. This
   used to be copy-pasted in both — pulled out here so a third add-flow
   (or an "edit location" feature later) is one call, not another copy.
═══════════════════════════════════════════════ */
const LocationPicker = {
  // Wires <input id=inputId> + <div id=suggestId> (Geocoder-style dropdown).
  // onPick(result) is called both on suggestion click and on Enter.
  initSearch(inputId, suggestId, onPick) {
    const input = document.getElementById(inputId);
    const suggest = document.getElementById(suggestId);
    if (!input || !suggest) return;

    const bias = () => ({ nearLat: State.userLat, nearLng: State.userLng });

    input.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (q.length < 3) { Geocoder.hide(suggest); return; }
      Geocoder.showLoading(suggest);
      Geocoder.onInput(inputId, q, 450, (results) => {
        Geocoder.renderSuggestions(suggest, results, onPick);
      }, bias());
    });

    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      Geocoder.showLoading(suggest);
      const results = await Geocoder.search(q, bias());
      // Address-shaped hits first so Enter doesn't land on a nearby
      // landmark POI when the user typed an actual address.
      const addressFirst = results.filter(r => Geocoder.isAddressType(r));
      const pool = addressFirst.length ? addressFirst : results;
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
    State[stateMapKey] = L.map(divId, { center, zoom: 15, zoomControl: false, attributionControl: false });
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
