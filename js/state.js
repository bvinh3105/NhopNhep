/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */
const State = {
  currentTab: 'home',
  userLat: null, userLng: null,
  radius: 1000,
  activeCats: new Set(['restaurant','street','snack','cafe']),
  activeSrcs: new Set(['osm','mine']),
  activeDish: '',    // free-text dish filter: "phở", "bún chả", "trà sữa"…
  minRating: 0,
  filteredResults: [],
  visibleResults: [],
  selected: new Set(),
  tabFilter: 'all',
  itinerary: [],
  dwellOverrides: {},
  mainMap: null, planMap: null,
  userMarker: null, radiusCircle: null,
  communityPickerMap: null, communityPickerMarker: null,

  // Profile persistence
  profile: {
    name: '',
    avatar: '🍜',
    prefs: new Set(),
    trips: 0,
    tripHistory: [], // [{ id, at, stops: [{ id, name, cat, price, address, lat, lng }] }]
    hideRandomPick: false, // ẩn nút 🎲 random món ở màn chính (xem HomeCtrl._openRandomPick)
  },
  // Lộ trình người dùng CHỦ ĐỘNG lưu, khác hẳn tripHistory:
  //  - tripHistory tự ghi mọi lần lên lịch và bị cắt còn 50 chuyến gần nhất,
  //    nên lộ trình định đi tháng sau dễ bị các lần dùng hằng ngày đẩy văng.
  //  - savedTrips có TÊN do người dùng đặt và không bao giờ bị tự xoá.
  //  - Mỗi lộ trình mang theo điểm xuất phát riêng, nên mở lại ở nhà (cách
  //    đó 500km, chưa bật GPS) vẫn dựng đúng đường đi tại nơi sắp tới.
  // [{ id, name, at, origin: { lat, lng, label }, stops: [...] }]
  savedTrips: [],
  userRestaurants: [],  // user-added
  osmRestaurants: [],   // fetched from OpenStreetMap
  communityRestaurants: [], // fetched from PocketBase, adapted to app shape
  savedPosts: new Set(), // community post IDs the user bookmarked (localStorage-scoped, per browser)
  lastScanSource: 'osm',
};

/* ═══════════════════════════════════════════════
   PERSISTENCE
═══════════════════════════════════════════════ */
const Storage = {
  KEY: 'nhopnhep_v1',
  save() {
    const data = {
      profile: {
        name: State.profile.name,
        avatar: State.profile.avatar,
        prefs: [...State.profile.prefs],
        trips: State.profile.trips,
        tripHistory: State.profile.tripHistory || [],
        hideRandomPick: !!State.profile.hideRandomPick,
      },
      userRestaurants: State.userRestaurants,
      savedPosts: [...State.savedPosts],
      savedTrips: State.savedTrips || [],
    };
    try { localStorage.setItem(this.KEY, JSON.stringify(data)); } catch(e) { console.warn(e); }
  },
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.profile) {
        State.profile.name = data.profile.name || '';
        State.profile.avatar = data.profile.avatar || '🍜';
        State.profile.prefs = new Set(data.profile.prefs || []);
        State.profile.trips = data.profile.trips || 0;
        State.profile.tripHistory = Array.isArray(data.profile.tripHistory) ? data.profile.tripHistory : [];
        State.profile.hideRandomPick = !!data.profile.hideRandomPick;
      }
      State.userRestaurants = data.userRestaurants || [];
      State.savedPosts = new Set(Array.isArray(data.savedPosts) ? data.savedPosts : []);
      State.savedTrips = Array.isArray(data.savedTrips) ? data.savedTrips : [];
    } catch(e) { console.warn(e); }
  },

  /* ─── Export / Import ─── */
  exportJSON() {
    const data = {
      _app: 'NhopNhep',
      _version: 1,
      _exported: new Date().toISOString(),
      profile: {
        name: State.profile.name,
        avatar: State.profile.avatar,
        prefs: [...State.profile.prefs],
        trips: State.profile.trips,
      },
      userRestaurants: State.userRestaurants,
      // Lộ trình đã lưu đi theo bản sao lưu — người dùng bỏ công lên lịch
      // cho chuyến đi sắp tới, đổi máy mà mất thì quá phí.
      savedTrips: State.savedTrips || [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nhopnhep-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    showToast(I18N.t('state.exported'));
  },

  importJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (data._app !== 'NhopNhep') {
        showToast(I18N.t('state.importBadFile'));
        return false;
      }
      if (data.profile) {
        State.profile.name = data.profile.name || '';
        State.profile.avatar = data.profile.avatar || '🍜';
        State.profile.prefs = new Set(data.profile.prefs || []);
        State.profile.trips = data.profile.trips || 0;
      }
      if (data.userRestaurants) {
        State.userRestaurants = data.userRestaurants;
      }
      // Gộp thêm chứ không ghi đè: nhập bản sao lưu cũ không được xoá mất
      // lộ trình vừa lên trên máy này. Trùng id thì giữ bản đang có.
      if (Array.isArray(data.savedTrips)) {
        const have = new Set((State.savedTrips || []).map(t => t.id));
        State.savedTrips = [...(State.savedTrips || []), ...data.savedTrips.filter(t => t && !have.has(t.id))];
      }
      this.save();
      showToast(I18N.t('state.imported'));
      return true;
    } catch(e) {
      console.warn('Import failed:', e);
      showToast(I18N.t('state.importInvalid'));
      return false;
    }
  },
};

/* ═══════════════════════════════════════════════
   LOCATION CACHE
   Nhớ vị trí lần user dùng cuối (GPS thật hoặc pick địa chỉ tay) để lần
   mở app sau map hiện đúng chỗ ngay, thay vì rơi về Hoàn Kiếm HN rồi
   mới nhảy đi. Tách khỏi Storage.KEY chính để không lẫn vào export/
   import backup — vị trí là dữ liệu phiên, không phải profile.
═══════════════════════════════════════════════ */
const LocationCache = {
  KEY: 'nhopnhep_loc_v1',
  MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 ngày

  // source: 'gps' | 'user_pick'. KHÔNG cache 'cf_geo' (city-accurate,
  // đủ cho phiên hiện tại nhưng user đổi mạng/VPN sẽ sai nếu dùng lại
  // 7 ngày sau) và 'hn_default' (fallback vô nghĩa để lưu).
  save(lat, lng, source, label) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (source !== 'gps' && source !== 'user_pick') return;
    try {
      localStorage.setItem(this.KEY, JSON.stringify({
        lat, lng, source, label: label || null, ts: Date.now(),
      }));
    } catch (_) { /* quota / private mode — không critical, bỏ qua */ }
  },

  // Trả về { lat, lng, source, label, ts } hoặc null nếu chưa có / hết hạn.
  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data.lat !== 'number' || typeof data.lng !== 'number') return null;
      if (!data.ts || Date.now() - data.ts > this.MAX_AGE_MS) return null;
      return data;
    } catch (_) { return null; }
  },
};
