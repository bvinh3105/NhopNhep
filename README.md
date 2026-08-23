# 🍜 Nhóp Nhép

> Chọn quán · Lên kế hoạch · Ăn thôi

Ứng dụng gợi ý quán ăn ngẫu nhiên gần vị trí người dùng và tự động lên lịch trình tối ưu cho chuyến đi ăn.

---

## Tính năng (Phase 1)

- **Tìm quán gần đây** — Dùng GPS hoặc nhập địa chỉ thủ công, chọn bán kính tìm kiếm (500m–5km)
- **4 danh mục quán** — Nhà hàng 🍽️ · Vỉa hè/Bình dân 🍜 · Ăn vặt 🧆 · Cà phê ☕
- **Shuffle + chọn quán** — Danh sách xáo ngẫu nhiên, chọn tối đa 6 quán
- **Lên lịch tự động** — Tính toán lộ trình tối ưu (greedy nearest-neighbor), thời gian di chuyển xe máy, thời gian ở tại quán
- **Dwell time mặc định** — Nhà hàng 60', Vỉa hè 30', Ăn vặt 20', Cà phê 45' — có thể chỉnh tay
- **Bản đồ Leaflet** — Hiển thị vị trí người dùng + lộ trình trên plan screen

## Tech stack

- Vanilla HTML/CSS/JS (single file, no build tools)
- [Leaflet.js](https://leafletjs.com/) cho bản đồ
- OpenStreetMap tiles
- Mock data: 24 quán ăn tại Quận 1, TP.HCM

## Chạy thử

Mở `index.html` trực tiếp trên trình duyệt — không cần server (trừ GPS cần HTTPS/localhost).

```bash
# Dùng một static server đơn giản:
npx serve .
# hoặc
python -m http.server 8080
```

## Roadmap

- [ ] Phase 2: Kết nối Google Places API — dữ liệu quán thật
- [ ] Geocoding địa chỉ thủ công
- [ ] Filter theo giá tiền
- [ ] Lịch sử chuyến đi
- [ ] Chia sẻ lịch trình qua link
- [ ] PWA (offline support)
