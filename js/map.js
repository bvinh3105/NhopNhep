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
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.getElementById('homeScreen').classList.add('hidden');
    document.getElementById('resultsScreen').classList.add('hidden');
    document.getElementById('planScreen').classList.add('hidden');
    document.getElementById('profileScreen').classList.add('hidden');
    if (tab === 'home') {
      document.getElementById('homeScreen').classList.remove('hidden');
      setTimeout(() => State.mainMap?.invalidateSize(), 60);
    } else if (tab === 'profile') {
      document.getElementById('profileScreen').classList.remove('hidden');
      ProfileCtrl.render();
    }
  },
};

/* ═══════════════════════════════════════════════
   TILE LAYER — CartoDB Voyager (warm, less blocked than OSM)
   With fallback if primary blocked
═══════════════════════════════════════════════ */
const TileLayer = {
  PRIMARY:  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  FALLBACK: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  SUBDOMAINS: 'abcd',

  add(map) {
    const layer = L.tileLayer(this.PRIMARY, {
      maxZoom: 19,
      subdomains: this.SUBDOMAINS,
      attribution: '',
      crossOrigin: true,
    });
    let failCount = 0;
    layer.on('tileerror', () => {
      failCount++;
      if (failCount === 3 && !layer._switched) {
        layer._switched = true;
        console.warn('[Tiles] CartoDB blocked, falling back to OSM');
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
    const lat = State.userLat || 10.7769;
    const lng = State.userLng || 106.7009;
    State.mainMap = L.map('mainMap', {
      center:[lat,lng], zoom:15,
      zoomControl:false, attributionControl:false,
    });
    TileLayer.add(State.mainMap);
    this.setUserLocation(lat, lng);
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
        }).addTo(State.mainMap);
      } else {
        State.radiusCircle.setLatLng([lat, lng]);
      }
      if (accuracy && accuracy > 0) {
        if (!State.accuracyCircle) {
          State.accuracyCircle = L.circle([lat,lng], {
            radius: accuracy, color:'#4CAF50', fillColor:'#4CAF50',
            fillOpacity:.10, weight:1.5, opacity:.5,
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
          <a href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}" 
             target="_blank" style="display:inline-block; margin-top:5px; color:#1565c0; text-decoration:none; font-weight:bold;">
            🗺️ Mở Google Maps
          </a>
        </div>
      `;
      marker.bindPopup(popupHtml);
      
      this._markers.push(marker);
    });
  }
};
