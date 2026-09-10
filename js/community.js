/* ═══════════════════════════════════════════════
   COMMUNITY — self-hosted PocketBase backend
   Local-first backend for the "cộng đồng nhỏ" feature: accounts, user-
   submitted quán ăn with photos, and upvotes so the group can pick
   together. Runs on PocketBase (see community-server/), reachable either
   on localhost during dev or through a Cloudflare Tunnel once exposed.

   Auth token + cached user are kept in localStorage (separate from the
   app's own localStorage state in state.js) so a page reload stays
   logged in without re-hitting the server.
═══════════════════════════════════════════════ */

const Community = {
  // Quick Tunnel URL — changes every time the tunnel process restarts (no
  // fixed domain on the free tier). Update this constant + redeploy when
  // it does; localhost stays the fallback for same-machine dev/testing.
  // Real users get this automatically, no per-device setup needed — the
  // ⚙️ "Đổi địa chỉ server" field in the Cộng đồng tab is just the manual
  // override for whenever this goes stale before a redeploy catches up.
  DEFAULT_URL: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://127.0.0.1:8090'
    : 'https://decreased-subject-multimedia-wolf.trycloudflare.com',
  get BASE_URL() {
    return (localStorage.getItem('community_api_url') || this.DEFAULT_URL).replace(/\/$/, '');
  },
  set BASE_URL(v) {
    const t = (v || '').trim();
    if (t) localStorage.setItem('community_api_url', t);
    else localStorage.removeItem('community_api_url');
  },

  TOKEN_KEY: 'community_token',
  USER_KEY: 'community_user',

  // ── Session ─────────────────────────────────────────────────────────────
  get token() { return localStorage.getItem(this.TOKEN_KEY) || ''; },
  set token(v) {
    if (v) localStorage.setItem(this.TOKEN_KEY, v);
    else localStorage.removeItem(this.TOKEN_KEY);
  },
  get currentUser() {
    try { return JSON.parse(localStorage.getItem(this.USER_KEY) || 'null'); }
    catch(e) { return null; }
  },
  set currentUser(u) {
    if (u) localStorage.setItem(this.USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(this.USER_KEY);
  },
  isLoggedIn() { return !!this.token && !!this.currentUser; },

  // ── Low-level fetch — PocketBase wants the raw token, no "Bearer " prefix ──
  // Security/reliability audit fixes (2026-09-08):
  //  - Added a real timeout (was the only fetch in the app with none — a
  //    server that's alive-but-slow, not fully dead, used to hang every
  //    vote/follow/post button forever with no recovery but a page reload).
  //  - 401 now fires a 'community:session-expired' event instead of only
  //    silently clearing localStorage — nothing was listening before, so
  //    the UI kept showing "logged in" until the user happened to switch
  //    tabs, and the generic error looked identical to "server is down".
  //  - A manually-overridden BASE_URL (community_api_url in localStorage)
  //    that's gone stale (leftover from testing, or a dead old tunnel) had
  //    no in-app way to clear itself since the settings field was hidden —
  //    self-heal once by falling back to DEFAULT_URL on a real connection
  //    failure instead of staying permanently dead for that one browser.
  async _fetch(path, opts = {}, _retried = false) {
    const headers = Object.assign({}, opts.headers);
    if (this.token) headers['Authorization'] = this.token;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(`${this.BASE_URL}${path}`, Object.assign({}, opts, { headers, signal: ctrl.signal }));
      clearTimeout(timer);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 401) {
          this.token = ''; this.currentUser = null;
          document.dispatchEvent(new CustomEvent('community:session-expired'));
          return { ok: false, status: 401, error: I18N.t('err.sessionExpired') };
        }
        return { ok: false, status: res.status, error: (data && data.message) || I18N.t('err.connectionGeneric') };
      }
      return { ok: true, data };
    } catch(e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        return { ok: false, status: 'timeout', error: I18N.t('err.serverSlow') };
      }
      const usingOverride = !!localStorage.getItem('community_api_url');
      if (!_retried && usingOverride) {
        console.warn('[Community] override URL unreachable, falling back to default once');
        this.BASE_URL = '';
        return this._fetch(path, opts, true);
      }
      return { ok: false, status: 0, error: I18N.t('err.serverUnreachable') };
    }
  },

  // ── Auth ────────────────────────────────────────────────────────────────
  async register(email, password, name) {
    const r = await this._fetch('/api/collections/users/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, passwordConfirm: password, name: name || '' }),
    });
    if (!r.ok) return r;
    return this.login(email, password); // auto sign-in right after signup
  },

  async login(email, password) {
    const r = await this._fetch('/api/collections/users/auth-with-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    });
    if (r.ok) { this.token = r.data.token; this.currentUser = r.data.record; }
    return r;
  },

  logout() { this.token = ''; this.currentUser = null; },

  // ── Restaurants ─────────────────────────────────────────────────────────
  async listRestaurants({ page = 1, perPage = 50, sort = '-created', filter = '' } = {}) {
    const q = new URLSearchParams({ page, perPage, sort, expand: 'created_by' });
    if (filter) q.set('filter', filter);
    return this._fetch(`/api/collections/restaurants/records?${q}`);
  },

  // Tab Cá nhân — mọi quán tôi từng đăng, bất kể độ mở (createRule/listRule
  // đều cho phép chủ quán xem chính mình regardless of visibility).
  async myRestaurants() {
    if (!this.isLoggedIn()) return { ok: true, data: { items: [] } };
    return this.listRestaurants({ filter: `created_by="${this.currentUser.id}"`, perPage: 100 });
  },

  // Sửa quán đã đăng — chỉ PATCH các field text/chọn, không đụng tới photos
  // (đổi ảnh làm ở form khác để tránh lẫn giữa ảnh cũ trên server và file mới
  // chọn trên máy).
  async updateRestaurant(id, { name, category, priceRange, description, address, lat, lng, tags, hashtags, visibility } = {}) {
    const body = {};
    if (name != null) body.name = name;
    if (category != null) body.category = category;
    if (priceRange != null) body.price_range = priceRange;
    if (description != null) body.description = description;
    if (address != null) body.address = address;
    if (lat != null && lng != null) body.location = { lon: lng, lat };
    if (tags != null) body.tags = this.normalizeTags(tags);
    if (hashtags != null) body.hashtags = this.normalizeHashtags(hashtags);
    if (visibility != null) body.visibility = visibility;
    return this._fetch(`/api/collections/restaurants/records/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  async deleteRestaurant(id) {
    return this._fetch(`/api/collections/restaurants/records/${id}`, { method: 'DELETE' });
  },

  // photoFiles: tối đa 4 ảnh (giới hạn server-side qua maxSelect). Ảnh đầu
  // tiên tự động thành thumbnail — đổi sau bằng setThumbnail().
  async createRestaurant({ name, category, priceRange, description, address, lat, lng, tags = [], hashtags = [], visibility = 'public', photoFiles = [], linkedTo = null }) {
    if (!this.isLoggedIn()) return { ok: false, error: I18N.t('err.needLogin')};
    const fd = new FormData();
    fd.append('name', name);
    fd.append('category', category);
    fd.append('visibility', ['private', 'friends', 'public'].includes(visibility) ? visibility : 'public');
    if (priceRange) fd.append('price_range', priceRange);
    if (description) fd.append('description', description);
    if (address) fd.append('address', address);
    if (lat != null && lng != null) fd.append('location', JSON.stringify({ lon: lng, lat }));
    fd.append('created_by', this.currentUser.id);
    fd.append('tags', JSON.stringify(this.normalizeTags(tags)));
    fd.append('hashtags', JSON.stringify(this.normalizeHashtags(hashtags)));
    // "Cùng 1 quán với..." — người đăng tự xác nhận (xem findSimilarNearby),
    // không bao giờ tự động gán. Đã làm phẳng về gốc nhóm ở nơi gọi (client).
    if (linkedTo) fd.append('linked_to', linkedTo);
    const files = photoFiles.slice(0, 4); // khớp maxSelect=4 phía server
    for (const file of files) {
      const blob = await this.compressImage(file);
      fd.append('photos', blob, (file.name || 'photo').replace(/\.\w+$/, '') + '.webp');
    }
    const r = await this._fetch('/api/collections/restaurants/records', { method: 'POST', body: fd });
    if (r.ok && r.data.photos && r.data.photos.length) {
      // Set thumbnail mặc định = ảnh đầu tiên vừa upload (tên file server sinh ra
      // chỉ biết được sau khi tạo record xong, nên phải PATCH thêm 1 lần).
      const t = await this.setThumbnail(r.data.id, r.data.photos[0]);
      if (t.ok) r.data = t.data;
    }
    return r;
  },

  // Đổi ảnh đại diện — filename phải nằm trong record.photos hiện có.
  async setThumbnail(restaurantId, filename) {
    return this._fetch(`/api/collections/restaurants/records/${restaurantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thumbnail: filename }),
    });
  },

  photoUrl(record, filename, thumb = '800x0') {
    if (!record || !filename) return '';
    return `${this.BASE_URL}/api/files/${record.collectionId}/${record.id}/${filename}?thumb=${thumb}`;
  },

  // Ảnh bìa hiển thị trong danh sách — fallback về ảnh đầu tiên nếu record cũ
  // chưa có thumbnail (ví dụ tạo trước khi field này tồn tại).
  thumbnailUrl(record, thumb = '800x0') {
    if (!record) return '';
    const filename = record.thumbnail || (record.photos && record.photos[0]);
    return this.photoUrl(record, filename, thumb);
  },

  // Toàn bộ ảnh của 1 quán (tối đa 4) — dùng cho carousel trong feed, thay vì
  // chỉ ảnh đại diện. Sắp thumbnail lên đầu nếu có, để carousel bắt đầu đúng
  // ảnh mà thumbnailUrl() cũng đang dùng làm ảnh bìa.
  photoUrls(record, thumb = '800x0') {
    if (!record || !record.photos || !record.photos.length) return [];
    const files = [...record.photos];
    if (record.thumbnail && files.includes(record.thumbnail)) {
      files.splice(files.indexOf(record.thumbnail), 1);
      files.unshift(record.thumbnail);
    }
    return files.map(f => this.photoUrl(record, f, thumb));
  },

  // ── Tags & hashtags ──────────────────────────────────────────────────────
  // Thẻ tự do người dùng gõ tay, hiển thị nguyên văn — "ăn nhẹ", "nhẹ bụng"...
  normalizeTags(tags) {
    const seen = new Set();
    const out = [];
    for (const raw of tags || []) {
      const t = String(raw).trim().slice(0, 30);
      const key = t.toLowerCase();
      if (!t || seen.has(key)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= 10) break;
    }
    return out;
  },

  // Hashtag kiểu YouTube — chỉ để tăng khả năng match khi search, không hiện
  // như đánh giá. Bỏ dấu '#' thừa, gộp khoảng trắng, lowercase để match ổn định.
  normalizeHashtags(hashtags) {
    const seen = new Set();
    const out = [];
    for (const raw of hashtags || []) {
      const t = String(raw).trim().replace(/^#+/, '').replace(/\s+/g, '').toLowerCase().slice(0, 24);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 15) break;
    }
    return out;
  },

  // Search đơn giản trên name/description/tags/hashtags. `~` của PocketBase so
  // khớp theo kiểu LIKE trên chuỗi JSON serialize của field — đủ dùng ở quy mô
  // 50-100 người; nếu sau này cần search nhanh/chính xác hơn thì tách tags
  // thành collection riêng có index.
  // Bỏ dấu tiếng Việt + lowercase — tìm không phân biệt hoa/thường, không
  // cần gõ đúng dấu, và né được lệch chuẩn hoá Unicode (cùng 1 chữ có dấu
  // đôi khi lưu ở 2 dạng byte khác nhau trông y hệt nhau nhưng so sánh
  // chuỗi thô không khớp — đây là nguyên nhân "cà phê chill" từng không
  // tìm ra khi gõ "cà phê").
  _normalize(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim();
  },

  // Server-side `~` trên field JSON (tags/hashtags) không đáng tin cho thứ
  // này — không rõ nó so khớp theo phần tử mảng hay theo chuỗi JSON thô.
  // Ở quy mô vài chục/vài trăm quán, tải hết rồi tự so khớp ở client vừa
  // đúng vừa cho fuzzy thật sự (chuẩn hoá dấu + khớp từng từ độc lập thứ tự,
  // nới lỏng dần nếu không ra kết quả nào).
  async searchRestaurants(query, { perPage = 200 } = {}) {
    const all = await this.listRestaurants({ perPage });
    if (!all.ok) return all;
    const q = this._normalize(query);
    if (!q) return all;
    const terms = q.split(/\s+/).filter(Boolean);
    const haystackOf = (r) => this._normalize(
      [r.name, r.description, r.address, ...(r.tags || []), ...(r.hashtags || [])].join(' ')
    );

    // Tier 1: mọi từ khoá đều khớp đâu đó (AND) — chính xác nhất.
    let items = all.data.items.filter(r => {
      const h = haystackOf(r);
      return terms.every(t => h.includes(t));
    });
    // Tier 2 — fuzzy fallback: không có gì khớp AND → nới thành khớp BẤT
    // KỲ từ nào (OR), để gõ thiếu/thừa chữ vẫn có cơ hội ra kết quả thay
    // vì im lặng trả về rỗng.
    if (!items.length) {
      items = all.data.items.filter(r => {
        const h = haystackOf(r);
        return terms.some(t => h.includes(t));
      });
    }
    return { ok: true, data: { ...all.data, items, totalItems: items.length } };
  },

  // ── "Cùng 1 quán" liên kết nhẹ (linked_to) ────────────────────────────────
  // Không đổi mô hình vote/riêng tư đang có — mỗi bài vẫn độc lập hoàn
  // toàn. `linked_to` chỉ là 1 nhãn tuỳ chọn người đăng tự xác nhận, KHÔNG
  // BAO GIỜ tự động gán. Mọi hàm dưới đây chỉ đọc qua listRestaurants() —
  // tức LUÔN đi qua đúng listRule phía server, không mở đường xem mới nào.

  // "Gốc nhóm" của 1 bài — chính nó nếu chưa liên kết, hoặc bài nó trỏ tới.
  resolveRootId(r) {
    return (r && r.linked_to) || (r && r.id) || null;
  },

  // Tìm bài GẦN GIỐNG mà NGƯỜI GỌI vốn đã có quyền xem (dùng đúng
  // listRestaurants() — server tự lọc theo visibility, không có gì mới ở
  // đây). So khớp: tên sau khi bỏ dấu/hoa-thường chứa nhau (2 chiều) +
  // trong bán kính ~80m. Chỉ trả về GỢI Ý — không tự gán, người đăng phải
  // tự xác nhận. `excludeId` để không tự khớp với chính bài đang sửa.
  async findSimilarNearby(name, lat, lng, excludeId = null) {
    const nName = this._normalize(name);
    if (!nName || lat == null || lng == null) return null;
    const all = await this.listRestaurants({ perPage: 200 });
    if (!all.ok) return null;
    const MAX_DIST_M = 80; // haversine() returns METERS — 80m đủ hẹp để 2 quán khác tên gần nhau hiếm khi lọt qua
    let best = null, bestDist = Infinity;
    for (const r of all.data.items) {
      if (r.id === excludeId) continue;
      if (!r.location) continue;
      const rName = this._normalize(r.name);
      if (!rName) continue;
      const nameMatches = rName.includes(nName) || nName.includes(rName);
      if (!nameMatches) continue;
      const dist = haversine(lat, lng, r.location.lat, r.location.lon);
      if (dist <= MAX_DIST_M && dist < bestDist) { best = r; bestDist = dist; }
    }
    return best;
  },

  // Toàn bộ bài trong 1 nhóm (gốc + mọi bài trỏ vào gốc) mà NGƯỜI GỌI vốn
  // đã có quyền xem — vẫn qua listRestaurants(), không có đường đọc mới.
  async getLinkedGroup(rootId) {
    if (!rootId) return [];
    const r = await this.listRestaurants({ filter: `id="${rootId}" || linked_to="${rootId}"`, perPage: 50 });
    return r.ok ? r.data.items : [];
  },

  // ── Stars ("càng nhiều sao càng ngon", kiểu GitHub) ──────────────────────
  // Vẫn dùng collection `votes` phía server (1 record = 1 sao từ 1 người,
  // unique theo restaurant+user) — chỉ đổi cách gọi/hiển thị ở tầng UI.
  async myVote(restaurantId) {
    if (!this.isLoggedIn()) return null;
    const filter = `restaurant="${restaurantId}" && user="${this.currentUser.id}"`;
    const r = await this._fetch(`/api/collections/votes/records?filter=${encodeURIComponent(filter)}`);
    return (r.ok && r.data.items[0]) || null;
  },

  async voteCount(restaurantId) {
    const filter = `restaurant="${restaurantId}"`;
    const r = await this._fetch(`/api/collections/votes/records?filter=${encodeURIComponent(filter)}&perPage=1`);
    return r.ok ? r.data.totalItems : 0;
  },

  // Vote/unvote toggle — unique (restaurant,user) index on the server means
  // a double-click race just 400s on the second insert, harmless to ignore.
  async toggleVote(restaurantId) {
    if (!this.isLoggedIn()) return { ok: false, error: I18N.t('err.needLogin')};
    const existing = await this.myVote(restaurantId);
    if (existing) {
      return this._fetch(`/api/collections/votes/records/${existing.id}`, { method: 'DELETE' });
    }
    return this._fetch('/api/collections/votes/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurant: restaurantId, user: this.currentUser.id }),
    });
  },

  // ── Friends ──────────────────────────────────────────────────────────────
  // Một chiều, không cần đối phương chấp nhận: A thêm B vào friends của A
  // nghĩa là quán A đăng ở chế độ "friends" sẽ hiện với B (xem rule server-side
  // trên collection restaurants). Không có nghĩa A thấy được đồ "friends" của B.
  async searchUsers(query) {
    const q = (query || '').trim().replace(/"/g, '');
    if (q.length < 2) return { ok: true, data: { items: [] } };
    const filter = `email ~ "${q}" || name ~ "${q}"`;
    return this._fetch(`/api/collections/users/records?perPage=10&filter=${encodeURIComponent(filter)}`);
  },

  async myFriends() {
    if (!this.isLoggedIn()) return { ok: true, data: { items: [] } };
    return this._fetch(`/api/collections/users/records/${this.currentUser.id}?expand=friends`);
  },

  // How many people have ME in THEIR friends list — a "follower count".
  // `users.listRule` is open to any logged-in member (needed so people can
  // search each other to add as friends — see migration 1725700005), so a
  // filtered list query works here without any new backend permission.
  async followerCount(userId) {
    const filter = `friends.id?="${userId}"`;
    const r = await this._fetch(`/api/collections/users/records?perPage=1&filter=${encodeURIComponent(filter)}`);
    return r.ok ? r.data.totalItems : 0;
  },

  // The actual follower LIST — same filter as followerCount, but returns
  // the user records. Used by the followers-tap modal in the profile.
  async followerList(userId, page = 1, perPage = 50) {
    const filter = `friends.id?="${userId}"`;
    return this._fetch(`/api/collections/users/records?perPage=${perPage}&page=${page}&filter=${encodeURIComponent(filter)}&sort=-updated`);
  },

  // Push the local emoji-avatar pick up to this user's record so OTHER
  // people's feed/profile views can show it (the picker itself was
  // localStorage-only before this). Best-effort — a failure here just
  // means the avatar stays local for now, nothing else breaks.
  async updateAvatar(avatar) {
    if (!this.isLoggedIn()) return { ok: false, error: I18N.t('err.needLogin') };
    const r = await this._fetch(`/api/collections/users/records/${this.currentUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_emoji: avatar }),
    });
    if (r.ok) this.currentUser = r.data;
    return r;
  },

  // Fetch another member's public record directly (name, avatar_emoji) —
  // needed for UserQuanModal's profile header even when that person has
  // zero visible posts (so there's no restaurant record to read
  // expand.created_by from instead).
  async getUser(userId) {
    return this._fetch(`/api/collections/users/records/${userId}`);
  },

  async _setFriends(ids) {
    const r = await this._fetch(`/api/collections/users/records/${this.currentUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friends: ids }),
    });
    if (r.ok) this.currentUser = r.data; // keep cached session user in sync
    return r;
  },

  async addFriend(userId) {
    if (!this.isLoggedIn()) return { ok: false, error: I18N.t('err.needLogin')};
    const cur = await this.myFriends();
    const ids = new Set((cur.ok && cur.data.friends) || []);
    ids.add(userId);
    return this._setFriends([...ids]);
  },

  async removeFriend(userId) {
    if (!this.isLoggedIn()) return { ok: false, error: I18N.t('err.needLogin')};
    const cur = await this.myFriends();
    const ids = new Set((cur.ok && cur.data.friends) || []);
    ids.delete(userId);
    return this._setFriends([...ids]);
  },

  // ── Client-side image prep ──────────────────────────────────────────────
  // Resizes to maxWidth and re-encodes as WebP. Drawing to <canvas> and
  // re-exporting drops all EXIF — including the GPS tag phones embed — so
  // this doubles as our privacy step, not just a disk-space one.
  compressImage(file, maxWidth = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) return resolve(blob);
          canvas.toBlob((jpegBlob) => resolve(jpegBlob), 'image/jpeg', quality); // WebP unsupported
        }, 'image/webp', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(I18N.t('err.imageUnreadable'))); };
      img.src = url;
    });
  },
};
