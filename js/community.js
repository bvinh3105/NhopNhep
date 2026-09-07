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
  // Override at runtime via localStorage('community_api_url') once the
  // Cloudflare Tunnel is up — e.g. https://community.nhopnhep.pages.dev
  DEFAULT_URL: 'http://127.0.0.1:8090',
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
  async _fetch(path, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (this.token) headers['Authorization'] = this.token;
    try {
      const res = await fetch(`${this.BASE_URL}${path}`, Object.assign({}, opts, { headers }));
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // Expired/invalid token — drop the stale session so UI can prompt re-login.
        if (res.status === 401) { this.token = ''; this.currentUser = null; }
        return { ok: false, status: res.status, error: (data && data.message) || 'Lỗi kết nối server cộng đồng' };
      }
      return { ok: true, data };
    } catch(e) {
      return { ok: false, status: 0, error: 'Không kết nối được server cộng đồng — server có đang chạy không?' };
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
    const q = new URLSearchParams({ page, perPage, sort });
    if (filter) q.set('filter', filter);
    return this._fetch(`/api/collections/restaurants/records?${q}`);
  },

  // photoFiles: tối đa 4 ảnh (giới hạn server-side qua maxSelect). Ảnh đầu
  // tiên tự động thành thumbnail — đổi sau bằng setThumbnail().
  async createRestaurant({ name, category, priceRange, description, address, lat, lng, tags = [], hashtags = [], photoFiles = [] }) {
    if (!this.isLoggedIn()) return { ok: false, error: 'Cần đăng nhập trước' };
    const fd = new FormData();
    fd.append('name', name);
    fd.append('category', category);
    if (priceRange) fd.append('price_range', priceRange);
    if (description) fd.append('description', description);
    if (address) fd.append('address', address);
    if (lat != null && lng != null) fd.append('location', JSON.stringify({ lon: lng, lat }));
    fd.append('created_by', this.currentUser.id);
    fd.append('tags', JSON.stringify(this.normalizeTags(tags)));
    fd.append('hashtags', JSON.stringify(this.normalizeHashtags(hashtags)));
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
  async searchRestaurants(query, { page = 1, perPage = 50 } = {}) {
    const q = (query || '').trim().replace(/"/g, '');
    if (!q) return this.listRestaurants({ page, perPage });
    const filter = `name ~ "${q}" || description ~ "${q}" || tags ~ "${q}" || hashtags ~ "${q}"`;
    return this.listRestaurants({ page, perPage, filter });
  },

  // ── Votes ("tùy chọn cùng nhau") ─────────────────────────────────────────
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
    if (!this.isLoggedIn()) return { ok: false, error: 'Cần đăng nhập trước' };
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
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh')); };
      img.src = url;
    });
  },
};
