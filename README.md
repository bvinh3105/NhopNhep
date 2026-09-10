# 🍜 Nhóp Nhép

> Random quán ngon gần bạn · AI + cộng đồng thật · Tự động lên lịch trình ăn uống

PWA giải quyết câu hỏi "hôm nay ăn gì?": quét quanh vị trí thật → AI + dữ liệu bản đồ mở trả về danh sách quán → xáo ngẫu nhiên để khỏi phân vân → chọn tối đa 6 quán → tự động dựng lịch trình đa điểm có tính giờ + dẫn đường thật. Có thêm lớp cộng đồng nhỏ kiểu mạng xã hội nhẹ (đăng quán, follow, vote).

**Không phải** app đặt/giao đồ ăn. **Không phải** app review/tìm kiếm thuần tuý — xem [`PROJECT_HANDOFF.md`](./PROJECT_HANDOFF.md) mục 9 để biết định vị so với ShopeeFood/GrabFood/Google Maps.

🔗 **Live**: https://nhopnhep.pages.dev

> 📋 Cần bối cảnh đầy đủ (kiến trúc, hạ tầng, nợ kỹ thuật, việc cần làm tiếp)? Đọc [`PROJECT_HANDOFF.md`](./PROJECT_HANDOFF.md) — file này chỉ là README ngắn gọn.

---

## ✨ Tính năng

### Quét & tìm quán (tab **Nhóp Nhép**)
- GPS live tracking hoặc gõ địa chỉ · bán kính 500m–5km · 4 danh mục (🍽️ Nhà hàng · 🍜 Vỉa hè · 🧆 Ăn vặt · ☕ Cà phê)
- Tìm theo tên món/quán cụ thể (accent-insensitive) · lọc rating tối thiểu
- 3 nguồn dữ liệu chọn được: 🌐 Địa điểm công khai (OSM/OpenStreetMap) · ⭐ Của tôi (localStorage) · 👥 Cộng đồng (quán do người khác đăng trên PocketBase)
- **AI (Gemini) + OpenStreetMap đua song song** — nguồn nào xong trước thắng; riêng tìm theo tên/món thì merge cả 2 nguồn để tăng độ phủ
- AI tự suy luận quốc gia/thành phố thật từ GPS (không mặc định Việt Nam), tự đổi tiền tệ/định dạng địa chỉ theo vùng
- Kết quả xáo ngẫu nhiên mỗi lần quét — chống phân tích liệt não, không phải sắp theo rating

### Lên lịch trình
- Chọn tối đa 6 quán → tự sắp thứ tự gần nhất (nearest-neighbor) → tính giờ đến/rời từng chỗ (dwell time theo danh mục, tốc độ giả định xe máy)
- Chỉnh dwell ±5 phút, cascade lại toàn bộ giờ các điểm sau
- Dẫn đường thật bám mặt đường (OSRM) + theo dõi vị trí sống, có fallback đường thẳng nếu OSRM lỗi
- Lịch sử chuyến đã đi + "đi lại" (replay) từ vị trí hiện tại

### Cộng đồng
- **Khách vãng lai (chưa login) vào cũng thấy** 10 quán mới nhất (không bị chặn bởi form login); nút "Đăng nhập" nhỏ ở top-right header khi muốn tham gia
- Feed kiểu Instagram: avatar + tên + thời gian tương đối + carousel ảnh vuốt được (tối đa 4 ảnh/bài) + nút ♥ + caption + tag/hashtag
- Lưới hồ sơ 3 cột (quán của bạn + xem hồ sơ người khác) kèm số liệu quán đã đăng / ★ nhận được / follower
- Đăng quán: tên, danh mục, giá, mô tả, vị trí (chọn trên map), tối đa 4 ảnh (tự nén WebP), tag + hashtag, 3 mức riêng tư (riêng tư/bạn bè/công khai)
- Follow 1 chiều kiểu Twitter, không cần đối phương chấp nhận
- **🔖 Lưu quán** (bookmark, localStorage per browser — không cần login) · **📋 Sao chép link** đến 1 quán cụ thể (dạng `nhopnhep.pages.dev/?q=<id>`, app tự mở modal chi tiết khi ai đó mở link)

### Cá nhân
- Layout Instagram-style: 1 identity block ở giữa (avatar community + username + 3 stat posts/stars/followers), filter tabs, grid ảnh quán đã đăng
- Top-right: **⚙️ Cài đặt** (avatar picker, tên, ngôn ngữ, sở thích, bạn bè) và **🔖 Quán đã lưu** (list bookmark, tap để mở chi tiết)
- Avatar emoji (18 lựa chọn, đồng bộ lên server để người khác thấy được)
- Song ngữ Việt/Anh toàn app, đổi tức thời không cần reload

### Analytics (observability)
- Custom event tracking → PocketBase collection `analytics_events` — 7 event: `app_open`, `scan`, `plan_built`, `detail_open`, `add_quán`, `login`/`register`, `follow`
- POST qua same-origin proxy `/api/log` (Cloudflare Function) — bypass ad blocker/tracking protection (verified: cross-origin bị chặn silent)
- Xem records/filter/export CSV thẳng trong PocketBase Admin UI
- Cloudflare Web Analytics beacon: placeholder sẵn trong `<head>` — cần paste token khi gắn

### PWA
- Cài được vào màn hình chính (manifest + icon SVG) — **chưa có offline/service worker**

---

## 🛠 Tech stack

Vanilla HTML/CSS/JS — **không framework, không build step**. 14 module `js/*.js` load tuần tự qua `<script>` trong `index.html` (xem thứ tự phụ thuộc trong `PROJECT_HANDOFF.md`).

- **Leaflet 1.9** — bản đồ
- **Google Gemini API** (`gemini-flash-lite-latest`) — gọi trực tiếp từ browser, key dùng chung (embedded, giới hạn theo hostname) + tuỳ chọn key riêng người dùng tự thêm
- **OpenStreetMap Overpass** — dữ liệu quán khi không dùng AI hoặc AI thất bại, qua Cloudflare Pages Function tự đua 3 mirror + cache edge
- **Photon (Komoot)** — autocomplete địa chỉ
- **OSRM** (public demo server) — dẫn đường thật
- **PocketBase** (tự host) — backend cộng đồng: tài khoản, quán đăng, vote, follow
- **Google Fonts** — Fraunces (display) + Plus Jakarta Sans (body)
- **localStorage** — persist profile, sở thích, ngôn ngữ, key AI riêng

---

## 🚀 Chạy thử local

```bash
npx serve . -l 5556
```
Mở http://localhost:5556 — GPS/HTTPS-only feature (như dẫn đường live) hoạt động bình thường trên `localhost`.

**Lưu ý**: trên `localhost`, `/api/overpass` (Cloudflare Function) không tồn tại — code tự nhận diện và gọi thẳng Overpass API công khai thay thế, không cần làm gì thêm. Tính năng Cộng đồng cần PocketBase chạy thật (xem `PROJECT_HANDOFF.md` mục 4) — nếu không có, tab Cộng đồng sẽ báo lỗi kết nối, các tab khác vẫn dùng bình thường.

---

## 📦 Deploy

**Cloudflare Pages — Direct Upload.** Đây **không phải** kiểu git-connected auto-deploy — `git push` một mình **không** deploy gì cả, phải chạy lệnh riêng:

```bash
npx wrangler pages deploy . --project-name=nhopnhep --branch=master --commit-dirty=true
```

Quy trình chuẩn mỗi lần sửa code (chi tiết trong `PROJECT_HANDOFF.md` mục 6):
1. `node --check js/<file>.js` sau mỗi lần sửa
2. Bump `?v=NNNN` trong TẤT CẢ thẻ `<script>`/`<link>` của `index.html` (cache-busting — bỏ bước này thì CDN giữ bản cũ)
3. Test sống trước khi deploy
4. `git add -A && git commit && git push origin master`
5. `wrangler pages deploy` như trên
6. `curl` xác nhận production đã lên bản mới

---

## 📁 Cấu trúc

```
NhopNhep/
├── index.html              ← markup + mọi <script>/<link> có ?v=NNNN
├── manifest.json           ← PWA manifest
├── icon.svg
├── css/styles.css          ← toàn bộ style (warm cream + tomato red)
├── js/
│   ├── app.js               boot sequence, event listener toàn cục
│   ├── controllers.js       UI controller (file lớn nhất — Home/Results/Plan/Profile/Community + modals)
│   ├── community.js         client API cho PocketBase
│   ├── gemini.js            gọi Gemini AI trực tiếp từ browser
│   ├── poi.js                parse dữ liệu Overpass (OSM)
│   ├── geocoder.js           Photon — autocomplete/reverse geocode
│   ├── map.js / gps.js / locationPicker.js   Leaflet, GPS, chọn vị trí
│   ├── i18n.js                engine song ngữ VI/EN
│   ├── state.js               state toàn cục + persist localStorage (bao gồm savedPosts bookmark)
│   ├── utils.js               CATEGORIES, helpers dùng chung, allRestaurants()
│   ├── analytics.js           custom event tracking → /api/log → PocketBase
│   └── security.js            chặn devtools/right-click cơ bản
├── functions/api/
│   ├── overpass.js          proxy + cache Overpass (đang dùng)
│   ├── log.js               same-origin proxy cho analytics beacon (đang dùng)
│   └── gemini-search.js     DORMANT — đọc comment đầu file trước khi động vào
├── PROJECT_HANDOFF.md       ← bối cảnh đầy đủ, đọc trước khi phát triển tiếp
└── README.md
```

Backend cộng đồng (PocketBase) nằm ở thư mục riêng ngoài repo này — xem `PROJECT_HANDOFF.md` mục 4.

---

## 🎨 Design language

Warm cream palette (`#FBF3D9`) + deep tomato red (`#B92626`) + orange accent (`#E8843C`). Card viền dày kiểu sticker, hard shadow. Fraunces italic cho headers, Plus Jakarta Sans cho body.

---

## 🗺 Đang thiếu / nợ kỹ thuật

Xem đầy đủ + xếp ưu tiên trong [`PROJECT_HANDOFF.md`](./PROJECT_HANDOFF.md) mục 5. Tóm tắt nhanh:

- [ ] Chưa có mô hình doanh thu
- [ ] Custom event tracking đã có (7 event → PocketBase); chưa gắn Cloudflare Web Analytics beacon cho traffic/geo/vitals
- [x] ~~Watchdog quên update `functions/api/log.js` khi tunnel rotate~~ — đã fix 2026-09-11, xem `PROJECT_HANDOFF.md` mục 4 cho phần còn lại chưa root-cause
- [ ] Quota Gemini dùng chung nhỏ, dễ cạn khi traffic cao
- [ ] Nhánh OSM-only vẫn hardcode giá kiểu VNĐ bất kể vùng thật
- [ ] Chưa có push notification / offline (service worker)
- [ ] Chưa có bình luận / activity feed cho cộng đồng
- [ ] Chưa có menu 3-chấm chặn user / báo cáo bài (Phase 2 — cần backend)
- [ ] Backend tự host trên máy cá nhân — vẫn là 1 điểm-lỗi-vật-lý dù đã có backup + watchdog tự phục hồi
