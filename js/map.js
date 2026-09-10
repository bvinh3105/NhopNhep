/* ═══════════════════════════════════════════════
   TAB NAVIGATION
═══════════════════════════════════════════════ */
const TabNav = {
  init() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTo(btn.dataset.tab);
      });
    });
  },
  switchTo(tab) {
    if (State.currentTab === tab) return;
    State.currentTab = tab;
    // Tab change hides every modal — an open modal from the prior tab
    // has no legitimate reason to hang around and just stacks over the
    // new screen's contents (verified user-facing bug 2026-09-11).
    document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.getElementById('homeScreen').classList.add('hidden');
    document.getElementById('resultsScreen').classList.add('hidden');
    document.getElementById('planScreen').classList.add('hidden');
    document.getElementById('profileScreen').classList.add('hidden');
    document.getElementById('communityScreen').classList.add('hidden');
    if (tab === 'home') {
      document.getElementById('homeScreen').classList.remove('hidden');
      setTimeout(() => State.mainMap?.invalidateSize(), 60);
    } else if (tab === 'profile') {
      document.getElementById('profileScreen').classList.remove('hidden');
      ProfileCtrl.render();
    } else if (tab === 'community') {
      document.getElementById('communityScreen').classList.remove('hidden');
      CommunityCtrl.render();
    }
  },
};

/* ═══════════════════════════════════════════════
   TILE LAYER — Esri World Street Map, grayscale-filtered; OSM fallback.
   (CartoDB's free rastertiles now require an API key — without one they
   used to silently return a watermarked "API KEY REQUIRED" placeholder
   image instead of an HTTP error, so a tileerror-based fallback never
   caught it. Tried OpenStreetMap's own tile server next, but it turned
   out to be DNS-blocked on at least one real tester's home router, and
   the obvious fallback — Wikimedia Maps — actively 403s any non-
   Wikimedia Referer ("Map tiles are restricted to Wikimedia & affiliated
   sites only"), so it never worked for us at all despite looking fine
   in isolated testing. Esri has no API key, sends a permissive
   Access-Control-Allow-Origin: *, and isn't Referer-gated — verified
   reachable on the same network where OSM/Wikimedia both failed.

   Briefly tried Esri's Light Gray Canvas (base+reference pair) for a
   cleaner gray look (2026-09-08), but it turned out to cap real detail
   at z16 (verified by downloading actual tile bytes, not just checking
   HTTP status — z17+ still returns 200 but the body is a 2.5KB "Map
   data not yet available" placeholder, the SAME silently-fake-success
   failure mode as the CartoDB/API-key issue this whole setup was built
   to dodge). Upscaling past z16 made deep zoom look visibly blurry —
   real streets no longer lining up crisply under the location marker,
   which read as "GPS isn't tracking right." World_Street_Map has
   genuine detail through z19 (verified the same way), so it's back as
   PRIMARY; the gray look now comes from a CSS grayscale filter on the
   tile pane instead of a different tile source, keeping full sharpness
   at every zoom the app actually uses.)
═══════════════════════════════════════════════ */
const TileLayer = {
  PRIMARY:  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  FALLBACK: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  // Audit fix (2026-09-08): switching to OSM after a SINGLE tileerror was
  // too eager — one transient dropped tile (weak wifi, or a coordinate at
  // the edge of Esri's coverage) permanently flipped the whole map to OSM
  // for the rest of the session, with the console log misleadingly
  // claiming "Esri unreachable". Require a burst of errors in a short
  // window — that's what an actual outage looks like.
  ERROR_THRESHOLD: 4,
  ERROR_WINDOW_MS: 4000,

  add(map) {
    const layer = L.tileLayer(this.PRIMARY, {
      maxZoom: 19,
      attribution: '',
      crossOrigin: true,
    });
    let errorTimes = [];
    layer.on('tileerror', () => {
      if (layer._switched) return;
      const now = Date.now();
      errorTimes.push(now);
      errorTimes = errorTimes.filter(t => now - t < this.ERROR_WINDOW_MS);
      if (errorTimes.length >= this.ERROR_THRESHOLD) {
        layer._switched = true;
        console.warn(`[Tiles] Esri: ${errorTimes.length} tile errors in ${this.ERROR_WINDOW_MS}ms, falling back to OSM`);
        layer.setUrl(this.FALLBACK);
      }
    });
    layer.addTo(map);
    return layer;
  },
};

/* ═══════════════════════════════════════════════
   MAP — HOME
═══════════════════════════════════════════════ */
const MapHome = {
  _markers: [], // to store restaurant markers

  init() {
    // Use Hà Nội as visual default but do NOT set State.userLat so scan()
    // knows the user hasn't chosen a real location yet (null = not set).
    const defLat = 21.0285, defLng = 105.8542;
    State.mainMap = L.map('mainMap', {
      center: [defLat, defLng], zoom: 15,
      zoomControl: false, attributionControl: false,
    });
    TileLayer.add(State.mainMap);
    // Only show user marker if we already have a real GPS/address fix
    if (State.userLat) this.setUserLocation(State.userLat, State.userLng);
  },
  
  setUserLocation(lat, lng, accuracy=null, opts={}) {
    const wasFirstFix = State.userLat == null;
    State.userLat = lat; State.userLng = lng;
    if (State.mainMap && (wasFirstFix || opts.center)) {
      State.mainMap.setView([lat, lng], 15);
    }
    const trackingCls = opts.tracking ? ' tracking' : '';
    if (State.mainMap) {
      if (!State.userMarker) {
        const icon = L.divIcon({
          html:`<div class="user-marker-inner${trackingCls}"></div>`,
          iconSize:[18,18], iconAnchor:[9,9], className:''
        });
        State.userMarker = L.marker([lat,lng],{icon, zIndexOffset:1000}).addTo(State.mainMap);
      } else {
        State.userMarker.setLatLng([lat, lng]);
        const inner = State.userMarker.getElement()?.querySelector('.user-marker-inner');
        if (inner) inner.classList.toggle('tracking', !!opts.tracking);
      }
      if (!State.radiusCircle) {
        State.radiusCircle = L.circle([lat,lng], {
          radius: State.radius, color:'#B92626', fillColor:'#B92626',
          fillOpacity:.08, weight:2, opacity:.5, dashArray:'6,4',
          interactive: false,  // don't capture pointer/touch events → map pans freely
        }).addTo(State.mainMap);
      } else {
        State.radiusCircle.setLatLng([lat, lng]);
      }
      if (accuracy && accuracy > 0) {
        if (!State.accuracyCircle) {
          State.accuracyCircle = L.circle([lat,lng], {
            radius: accuracy, color:'#4CAF50', fillColor:'#4CAF50',
            fillOpacity:.10, weight:1.5, opacity:.5,
            interactive: false,
          }).addTo(State.mainMap);
        } else {
          State.accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
        }
      }
    }
  },

  clearAccuracyCircle() {
    if (State.accuracyCircle) { try { State.accuracyCircle.remove(); } catch(_){} State.accuracyCircle = null; }
  },

  updateRadius() {
    if (State.radiusCircle) State.radiusCircle.setRadius(State.radius);
  },

  // New method: Show scanned restaurants directly on the home map
  showRestaurants(results) {
    if (!State.mainMap) return;
    
    // Clear old markers
    this._markers.forEach(m => m.remove());
    this._markers = [];

    // Add new markers
    results.forEach(r => {
      const cat = CATEGORIES[r.cat];
      const isOsm = r.id >= 1e13;
      const bg = isOsm ? cat.color : '#E8843C'; // highlight user-added differently if needed
      
      const icon = L.divIcon({
        html:`<div class="r-map-marker" style="background:${bg}; font-size: 0.75rem;">${cat.icon}</div>`,
        iconSize:[26,26], iconAnchor:[13,13], className:''
      });
      
      const marker = L.marker([r.lat, r.lng], {icon}).addTo(State.mainMap);
      
      // Bind popup with basic info and link
      const popupHtml = `
        <div style="font-family: var(--font-body); font-size: 0.8rem;">
          <strong style="display:block; font-family: var(--font-display); font-size: 0.95rem;">${r.name}</strong>
          <span style="color: #6B4A38">${cat.label} · ${r.price}</span><br>
          <a href="${gmapsUrl(r)}"
             target="_blank" rel="noopener" style="display:inline-block; margin-top:5px; color:#1565c0; text-decoration:none; font-weight:bold;">
            🗺️ Mở Google Maps
          </a>
        </div>
      `;
      marker.bindPopup(popupHtml);
      
      this._markers.push(marker);
    });
  }
};
