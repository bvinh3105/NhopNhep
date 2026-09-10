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
