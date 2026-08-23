# 🍜 Nhóp Nhép

> Random quán ăn gần bạn · Lên lịch trình tự động cho chuyến đi ăn

Ứng dụng gợi ý quán ăn ngẫu nhiên gần vị trí người dùng và tự động sinh lịch trình tối ưu.

---

## ✨ Tính năng

### Tab **Nhóp Nhép** (chính)
- **Tìm quán gần đây** — GPS live tracking hoặc nhập địa chỉ, bán kính 500m–5km
- **4 danh mục** — 🍽️ Nhà hàng · 🍜 Vỉa hè · 🧆 Ăn vặt · ☕ Cà phê
- **Shuffle + chọn nhiều quán** — Danh sách ngẫu nhiên, chọn tối đa 6 quán
- **Lên lịch tự động** — Greedy nearest-neighbor, tính thời gian di chuyển xe máy + dwell time
- **Điều chỉnh dwell** — Chỉnh ± từng quán (bước 5p), cascade thời gian các stop sau

### Tab **Cá nhân**
- **Profile** — Avatar (18 emoji xoay vòng), tên, sở thích
- **Sở thích** — Loại quán ưu tiên + tầm giá (bình dân/sang chảnh)
- **"Quán của tôi"** — Tự thêm quán bạn từng ghé (tên, loại, giá, mô tả, vị trí trên map)
- **Stats** — Số quán tự thêm · Số chuyến đã lên · Category yêu thích
- **Persist** — Lưu tự động vào `localStorage`, không mất khi reload

### GPS tracking
- Bấm 📍 → bật **watchPosition** liên tục (marker xanh, pulse, có accuracy circle)
- Bấm 📍 lần nữa → tắt tracking
- Hint chính xác: `🎯 ±10m` / `📡 ±50m` / `⚠️ ±200m — ra chỗ thoáng`
- **Cần HTTPS** để chạy trên điện thoại (Netlify tự cấp)

---

## 🚀 Chạy thử

### Local (máy tính, GPS OK)
```bash
npx serve . -l 5556
```
Rồi mở http://localhost:5556

### Trên điện thoại (Chrome / Safari / Edge / Cốc Cốc)
GPS bắt buộc HTTPS → deploy Netlify:

```bash
# Cài Netlify CLI (1 lần)
npm i -g netlify-cli

# Deploy production
netlify deploy --prod --dir=.
```

Hoặc kéo-thả folder này vào **[app.netlify.com/drop](https://app.netlify.com/drop)** — được URL `xxxxx.netlify.app` xài liền.

---

## 🛠 Tech stack

- **Vanilla HTML/CSS/JS** — 1 file `index.html`, không build tools
- **Leaflet 1.9** + **OpenStreetMap** — bản đồ
- **Google Fonts** — Fraunces (display) + Plus Jakarta Sans (body)
- **localStorage** — persist profile & user restaurants
- **PWA-ready** — manifest + SVG icon, có thể "Add to Home Screen"

---

## 📁 Cấu trúc

```
NhopNhep/
├── index.html      ← toàn bộ app
├── manifest.json   ← PWA manifest
├── icon.svg        ← app icon
├── netlify.toml    ← config deploy (permissions-policy cho geolocation)
└── README.md
```

---

## 🎨 Design language

Warm cream palette (`#FBF3D9`) + deep tomato red (`#B92626`) + orange accent (`#E8843C`). Sticker-style cards với hard shadow. Fraunces italic cho headers.

Cảm hứng từ mockup **"BAKE TODAY"** — style "food app" đầm ấm, gợi thèm ăn.

---

## 🗺 Roadmap

- [ ] Kết nối Google Places API — dữ liệu quán thật
- [ ] Geocoding cho địa chỉ nhập tay
- [ ] Filter theo giá tiền + rating
- [ ] Chia sẻ lịch trình qua link
- [ ] Lịch sử chuyến đã đi
- [ ] Ghi note sau chuyến (quán nào ngon/dở)
- [ ] Import/export data (JSON backup)
- [ ] Multi-city support
