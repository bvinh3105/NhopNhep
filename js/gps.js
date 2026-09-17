/* ═══════════════════════════════════════════════
   GPS — one-shot + continuous tracking
   HTTPS required on real devices (localhost is OK).
═══════════════════════════════════════════════ */
const GPS = {
  _watchId: null,
  _tracking: false,
  _lastAccuracy: null,
  _sessionFirstFix: false,

  isSecure() {
    return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  },

  hint(msg, cls='') {
    const el = document.getElementById('gpsHint');
    if (!el) return;
    if (!msg) { el.classList.remove('show'); return; }
    el.textContent = msg;
    el.className = 'gps-hint show '+cls;
  },

  toggle() {
    if (!navigator.geolocation) { showToast(I18N.t('toast.gpsNotSupported')); return; }
    if (!this.isSecure()) {
      this.hint(I18N.t('gps.httpsHint'), 'warn');
      showToast(I18N.t('gps.httpsToast'));
      return;
    }
    if (this._tracking) {
      this.stopTracking();
      return;
    }
    this.startTracking();
  },

  startTracking() {
    if (this._tracking) return;
    const btn = document.getElementById('gpsBtn');
    btn.innerHTML = svgIcon('status-loading');
    btn.classList.remove('active');
    this.hint(I18N.t('gps.turningOn'));
    this._sessionFirstFix = true;
    this._watchId = navigator.geolocation.watchPosition(
      pos => this._onPosition(pos),
      err => this._onError(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
    );
    this._tracking = true;
  },

  stopTracking() {
    if (this._watchId != null) {
      try { navigator.geolocation.clearWatch(this._watchId); } catch(_){}
      this._watchId = null;
    }
    this._tracking = false;
    const btn = document.getElementById('gpsBtn');
    btn.classList.remove('tracking');
    btn.classList.add('active');
    btn.innerHTML = svgIcon('action-gps');
    MapHome.clearAccuracyCircle();
    this.hint(I18N.t('gps.stopped'), '');
    setTimeout(() => this.hint(''), 2500);
    if (State.userLat) MapHome.setUserLocation(State.userLat, State.userLng, null, { tracking:false });
  },

  _onPosition(pos) {
    const {latitude:lat, longitude:lng, accuracy} = pos.coords;
    this._lastAccuracy = accuracy;
    const shouldCenter = this._sessionFirstFix;
    this._sessionFirstFix = false;
    MapHome.setUserLocation(lat, lng, accuracy, { center: shouldCenter, tracking: true });
    State._locKind = 'gps';
    LocationCache.save(lat, lng, 'gps');

    // Reverse geocode optionally or just show coordinates
    document.getElementById('locInput').value = I18N.t('gps.yourLocation');

    const btn = document.getElementById('gpsBtn');
    btn.innerHTML = svgIcon('action-gps');
    btn.classList.remove('active');
    btn.classList.add('tracking');

    let hintCls = 'tracking';
    let msg;
    if (accuracy <= 20) msg = I18N.t('gps.highAccuracy', { n: Math.round(accuracy) });
    else if (accuracy <= 100) msg = I18N.t('gps.acquiring', { n: Math.round(accuracy) });
    else { msg = I18N.t('gps.weakSignal', { n: Math.round(accuracy) }); hintCls = 'warn'; }
    this.hint(msg, hintCls);

    if (shouldCenter) showToast(I18N.t('gps.enabledToast'));
  },

  _onError(err) {
    const msgs = {
      1: I18N.t('gps.err.denied'),
      2: I18N.t('gps.err.unavailable'),
      3: I18N.t('gps.err.timeout'),
    };
    const msg = msgs[err.code] || I18N.t('gps.err.generic');
    showToast(msg);
    this.hint(msg + I18N.t('gps.retryHint'), 'warn');
    this.stopTracking();
  },

  silentFix() {
    if (!navigator.geolocation || !this.isSecure()) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        const {latitude:lat, longitude:lng, accuracy} = pos.coords;
        MapHome.setUserLocation(lat, lng, accuracy, { center:true, tracking:false });
        State._locKind = 'gps';
        LocationCache.save(lat, lng, 'gps');
        document.getElementById('locInput').value = I18N.t('gps.yourLocation');
        document.getElementById('gpsBtn').classList.add('active');
      },
      () => {},
      { enableHighAccuracy:false, timeout:4000, maximumAge:60000 }
    );
  },
};
