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
    if (!navigator.geolocation) { showToast('⚠️ Trình duyệt không hỗ trợ GPS'); return; }
    if (!this.isSecure()) {
      this.hint('⚠️ GPS cần HTTPS. Vui lòng dùng https:// hoặc localhost', 'warn');
      showToast('⚠️ GPS chỉ hoạt động qua HTTPS!');
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
    btn.textContent = '⏳';
    btn.classList.remove('active');
    this.hint('🛰 Đang bật GPS…');
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
    btn.textContent = '📍';
    MapHome.clearAccuracyCircle();
    this.hint('✋ Đã dừng theo dõi vị trí', '');
    setTimeout(() => this.hint(''), 2500);
    if (State.userLat) MapHome.setUserLocation(State.userLat, State.userLng, null, { tracking:false });
  },

  _onPosition(pos) {
    const {latitude:lat, longitude:lng, accuracy} = pos.coords;
    this._lastAccuracy = accuracy;
    const shouldCenter = this._sessionFirstFix;
    this._sessionFirstFix = false;
    MapHome.setUserLocation(lat, lng, accuracy, { center: shouldCenter, tracking: true });
    
    // Reverse geocode optionally or just show coordinates
    document.getElementById('locInput').value = `📍 Vị trí GPS của bạn`;

    const btn = document.getElementById('gpsBtn');
    btn.textContent = '📍';
    btn.classList.remove('active');
    btn.classList.add('tracking');

    let hintCls = 'tracking';
    let msg;
    if (accuracy <= 20) msg = `🎯 Chính xác cao · ±${Math.round(accuracy)}m`;
    else if (accuracy <= 100) msg = `📡 Đang bắt sóng · ±${Math.round(accuracy)}m`;
    else { msg = `⚠️ Tín hiệu yếu · ±${Math.round(accuracy)}m — ra chỗ thoáng`; hintCls = 'warn'; }
    this.hint(msg, hintCls);

    if (shouldCenter) showToast('✅ Đã bật GPS · theo dõi liên tục');
  },

  _onError(err) {
    const msgs = {
      1: '🚫 Bạn đã từ chối quyền truy cập vị trí',
      2: '⚠️ Không lấy được vị trí — kiểm tra GPS/mạng',
      3: '⏱ Timeout — thử ra chỗ thoáng',
    };
    const msg = msgs[err.code] || '⚠️ Lỗi GPS';
    showToast(msg);
    this.hint(msg + ' · nhấn 📍 để thử lại', 'warn');
    this.stopTracking();
  },

  silentFix() {
    if (!navigator.geolocation || !this.isSecure()) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        const {latitude:lat, longitude:lng, accuracy} = pos.coords;
        MapHome.setUserLocation(lat, lng, accuracy, { center:true, tracking:false });
        document.getElementById('locInput').value = `📍 Vị trí GPS của bạn`;
        document.getElementById('gpsBtn').classList.add('active');
      },
      () => {},
      { enableHighAccuracy:false, timeout:4000, maximumAge:60000 }
    );
  },
};
