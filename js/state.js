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
