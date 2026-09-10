# Nhóp Nhép — Tài liệu bàn giao dự án

> Viết ngày 2026-09-10, sau ~2.5 tuần phát triển (bắt đầu 2026-08-23, 101 commit).
> Mục đích: để một phiên Claude khác (hoặc chính bạn sau này) đọc 1 file này là nắm được toàn bộ bối cảnh, không cần hỏi lại từ đầu.

---

## 1. Dự án là gì

**Nhóp Nhép** — PWA giải quyết câu hỏi "hôm nay ăn gì?" bằng cách: quét quanh vị trí thật → AI + dữ liệu bản đồ mở trả về danh sách quán → xáo ngẫu nhiên (chống phân tích liệt não) → chọn tối đa 6 quán → tự động dựng lịch trình đa điểm có tính giờ + dẫn đường thật. Có thêm lớp cộng đồng nhỏ (đăng quán, follow, vote) kiểu mạng xã hội nhẹ.

**Không phải** app đặt/giao đồ ăn. **Không phải** app review/tìm kiếm thuần tuý. Xem thêm phần định vị cạnh tranh trong bản pitch deck (mục 9).

- **Live**: https://nhopnhep.pages.dev
- **Repo**: `bvinh3105/NhopNhep` (private), nhánh `master`
- **Deploy**: Cloudflare Pages **Direct Upload** — `git push` KHÔNG tự deploy, phải chạy `npx wrangler pages deploy . --project-name=nhopnhep --branch=master --commit-dirty=true` sau mỗi lần push.
- **Cache-busting hiện tại**: `v=2485` — mọi `<script>`/`<link>` trong `index.html` đều có `?v=NNNN`, phải bump số này (sed replace toàn bộ) trước mỗi lần deploy có sửa code, nếu không CDN/trình duyệt sẽ giữ bản cũ.

---

## 2. Kiến trúc & tech stack

Vanilla HTML/CSS/JS thuần — **không** framework, **không** build step, **không** `package.json` cho frontend. 13 file `js/*.js` load tuần tự qua thẻ `<script>` trong `index.html` (thứ tự phụ thuộc: `security.js` → `i18n.js` → `utils.js` → `state.js` → `poi.js` → `geocoder.js` → `gemini.js` → `community.js` → `map.js` → `gps.js` → `locationPicker.js` → `controllers.js` → `app.js`).

| File | Vai trò |
|---|---|
| `app.js` | Boot sequence, event listener toàn cục (i18n:changed, community:session-expired) |
| `controllers.js` | **File lớn nhất** — toàn bộ UI controller (HomeCtrl, ResultsCtrl, PlanCtrl, ProfileCtrl, CommunityCtrl, các Modal) |
| `community.js` | Client API cho PocketBase (auth, CRUD quán, vote, friends/follow, avatar) |
| `gemini.js` | Gọi Gemini AI trực tiếp từ browser (`gemini-flash-lite-latest`) |
| `poi.js` | Parse dữ liệu Overpass (OSM) thành object quán |
| `geocoder.js` | Photon (Komoot) — autocomplete địa chỉ + reverse geocode |
| `map.js` / `gps.js` / `locationPicker.js` | Leaflet map, GPS tracking, chọn vị trí trên map |
| `i18n.js` | Engine song ngữ VI/EN (dictionary phẳng key→string) |
| `state.js` | State toàn cục + persist localStorage + export/import JSON |
| `utils.js` | `CATEGORIES`, `parseOpeningHours`, `timeAgo`, `authorAvatar`, escape helpers |
| `security.js` | Chặn devtools/right-click cơ bản (tự nhận là "bypass được trong vài giây", chỉ mang tính ngăn cản nhẹ) |

**Functions (Cloudflare Pages, `functions/api/`)**:
- `overpass.js` — proxy + đua 3 mirror Overpass + cache edge 5 phút. **Đang dùng, hoạt động tốt.**
- `gemini-search.js` — **DORMANT, không dùng.** Từng thử proxy+cache Gemini qua đây để tiết kiệm quota, nhưng phát hiện Cloudflare chạy Function cho traffic từ Việt Nam ở trạm Hong Kong, mà Gemini API chặn cứng request từ Hong Kong. Đã revert, giữ lại file kèm comment giải thích để không tốn công thử lại. Xem commit `1c875bf`.

**External APIs** (miễn phí, không có SLA chính thức — xem mục "Rủi ro hạ tầng"):
- Gemini API (`gemini-flash-lite-latest`) — key dùng chung (embedded, fragment trong `gemini.js`) + tuỳ chọn key riêng người dùng tự thêm. Free tier ước tính ~1.000-1.500 request/ngày CHUNG cho toàn app.
- OpenStreetMap Overpass — dữ liệu quán khi không dùng AI hoặc AI thất bại.
- Photon (Komoot) — autocomplete địa chỉ.
- OSRM public demo server (`router.project-osrm.org`) — dẫn đường thật; có fallback về đường thẳng nếu lỗi.

**Backend cộng đồng**: PocketBase v0.40.3, tự host **trên chính máy tính cá nhân của bạn** (không phải VPS), tunnel ra ngoài qua Cloudflare Quick Tunnel (URL đổi mỗi lần restart). Chi tiết đầy đủ ở mục 4.

---

## 3. Tính năng đã có (đều đã test thật, không phải mock)

**Quét & tìm quán**: GPS live hoặc gõ địa chỉ · 4 danh mục · bán kính 500m-5km · tìm theo tên món/quán cụ thể · lọc rating tối thiểu · đua song song Gemini + OSM, ai xong trước thắng (trừ tìm theo tên/món thì merge cả 2 nguồn) · random hoá kết quả mỗi lần quét.

**AI hiểu vùng miền**: Gemini tự suy luận quốc gia/thành phố thật từ GPS thay vì mặc định Việt Nam, tự đổi định dạng tiền tệ/địa chỉ theo vùng. (Nhánh OSM-only vẫn CHƯA làm được việc này — xem mục 5.)

**Lên lịch trình**: nearest-neighbor sắp thứ tự điểm, dwell time mặc định theo danh mục, tốc độ di chuyển giả định xe máy (~25km/h), điều chỉnh dwell ±5 phút cascade toàn bộ giờ sau đó, dẫn đường thật bám mặt đường (OSRM) + theo dõi vị trí sống, lịch sử chuyến + "đi lại" từ vị trí hiện tại.

**Cộng đồng** (mới redesign xong, xem mục 4):
- Feed kiểu Instagram: avatar + tên + thời gian tương đối + carousel ảnh vuốt được (tối đa 4 ảnh) + nút ♥ + caption + tag/hashtag.
- Lưới hồ sơ 3 cột (Quán của tôi + xem hồ sơ người khác) + header avatar/tên/3 số liệu (quán đã đăng/★ nhận được/follower — follower count tính thật qua field `friends`).
- Đăng quán: tên, danh mục, giá, mô tả, vị trí (map picker), tối đa 4 ảnh (nén WebP client-side), tag tự do + hashtag riêng, 3 mức riêng tư (private/friends/public).
- Follow 1 chiều kiểu Twitter (field `friends` trên `users`, không cần đối phương chấp nhận).
- Sửa/xoá quán của mình qua modal chi tiết (bấm vào quán → nếu là chủ thì hiện nút Sửa/Xoá thay vì tác giả+tim).
- Avatar emoji giờ đồng bộ lên server (`avatar_emoji` field, xem mục 4) — trước đây chỉ lưu local, người khác không thấy được.

**Song ngữ VI/EN**: toàn app, ~300 key, đổi ngôn ngữ tức thời không reload, chọn trong modal Tài khoản.

**PWA**: cài được vào màn hình chính, có manifest + icon SVG. **KHÔNG có offline/service worker** dù là PWA.

---

## 4. Hạ tầng vận hành — quan trọng, đọc kỹ trước khi đổi gì

Thư mục: `G:\0. Home_Vinh\Projects\NhopNhep-community-server\` (nằm ngoài git — đây KHÔNG phải repo riêng, chỉ là file trên máy, đang nằm lẫn trong 1 workspace git của dự án khác (`bop_chop`) nên đừng git-add nhầm).

- `pocketbase.exe serve --http=127.0.0.1:8090` + `cloudflared.exe tunnel --url http://127.0.0.1:8090` (Quick Tunnel — ẩn danh, URL dạng `https://xxx.trycloudflare.com`, **đổi mỗi lần restart**).
- Máy: i5-12400F 6 nhân/12 luồng, 32GB RAM — dư sức, KHÔNG phải điểm nghẽn. Điểm nghẽn thật là **băng thông mạng** (đo thật: ~22 Mbps down / ~18 Mbps up) và **độ ổn định kết nối** (đang qua WiFi, không phải dây mạng — nên cân nhắc đổi sang Ethernet nếu máy hay rớt mạng).
- **2 Scheduled Task đã bật** (Task Scheduler Windows, tên bắt đầu `NhopNhep-`):
  - `NhopNhep-Backup` — robocopy mirror `pb_data` → `F:\Backup\NhopNhep-pb_data` mỗi 6 tiếng.
  - `NhopNhep-Watchdog` — chạy `Bat-TOAN-BO-Auto.ps1` mỗi 5 phút, tự kiểm tra PocketBase + tunnel còn sống không; nếu sập thì tự khởi động lại, lấy URL tunnel mới, tự sửa `js/community.js`, tự bump cache version, tự git commit/push, tự `wrangler pages deploy`. Đã test thật bằng cách kill process giả lập sập — tự phục hồi hoàn toàn trong ~2 phút.
  - Script gốc `Bat-TOAN-BO.ps1` (có `Read-Host` chờ Enter) vẫn còn, dùng khi bạn tự double-click thủ công từ Desktop — đừng schedule cái này (sẽ treo vô hạn vì không ai bấm Enter).
- **Migration mới**: `pb_migrations/1725700007_add_user_avatar.js` — thêm field `avatar_emoji` (text) vào `users`. Đã áp dụng live bằng cách restart PocketBase (không cần đụng tunnel).
- **Superuser**: email/password nằm trong `README.md` của thư mục community-server (đã đổi 1 lần sau khi phát hiện lộ qua tunnel công khai — xem CHANGELOG/README ở đó, KHÔNG chép lại ở đây).
- Dữ liệu thật hiện tại: rất ít (3 quán cộng đồng, vài chục KB) — quy mô còn rất sớm.

**Điều CHƯA làm dù đã khuyến nghị** (từ chính README của community-server):
- [ ] Viết Privacy Policy
- [ ] Test tunnel qua ít nhất 1 lần restart máy thật (đã test restart process, chưa test restart CẢ MÁY)
- [ ] Cấu hình SMTP thật → nút "Quên mật khẩu"/xác thực email hiện KHÔNG hoạt động (không chặn dùng app, nhưng UX thiếu)

---

## 5. Đã biết còn thiếu / nợ kỹ thuật — ưu tiên xử lý

Xếp theo mức độ quan trọng, không phải thứ tự thời gian:

1. **Không có mô hình doanh thu** — chưa có bất kỳ tích hợp thanh toán/subscription/quảng cáo nào.
2. **Không có analytics/telemetry** — 0 công cụ đo lường, không biết ai đang dùng app, dùng bao nhiêu, ở đâu.
3. **Quota Gemini dùng chung nhỏ và dễ cạn** (~1.000-1.500 request/ngày CHUNG toàn app) — khi cạn thì tự rớt về OSM (không sập, chỉ kém chính xác hơn). Đã thêm cơ chế "cooldown 3h" để không lãng phí request thử lại vô ích khi biết đã cạn. Giải pháp thật (nâng gói trả phí) CHƯA làm.
4. **Nhánh OSM-only vẫn hardcode giá kiểu VNĐ** ("40k-80k") bất kể vùng thật — phần region-aware chỉ áp dụng cho nhánh Gemini, chưa lan sang OSM.
5. **Không có push notification, không service worker** — dù là PWA, không dùng được offline.
6. **Chưa có tính năng bình luận / hoạt động bạn bè (activity feed)** — đã bàn hướng (xem mục 7 "Đã bàn nhưng chưa làm"), người dùng chọn ưu tiên feed ảnh trước, phần này để sau.
7. **Chưa có hệ thống report/kiểm duyệt nội dung cộng đồng** — quy mô nhỏ nên chưa cấp thiết, nhưng cần trước khi mở rộng nhiều người lạ.
8. **Backend tự host trên máy cá nhân** — dù đã có backup + watchdog tự phục hồi, vẫn là 1 điểm-lỗi-duy-nhất về mặt vật lý (máy tắt hẳn/hỏng ổ = mất hết, dù backup giảm thiểu rủi ro mất dữ liệu). Khuyến nghị dài hạn: chuyển sang VPS nhỏ (~$4-6/tháng) khi có ngân sách — theo README của community-server, việc này chỉ là copy `pocketbase.exe` + `pb_data/` sang, không cần sửa code.
9. **1 người phát triển duy nhất** — rủi ro key-person, không có ai backup kiến thức nếu bạn vắng mặt (tài liệu này một phần để giảm thiểu rủi ro đó).
10. **Key Gemini dùng chung nhúng trong client** (dù đã fragment + giới hạn theo hostname) — không phải bí mật thật, chỉ là rào cản nhẹ. Từng bị lộ mật khẩu PocketBase qua tunnel công khai 1 lần (đã phát hiện + đổi).

---

## 6. Quy ước làm việc đã thiết lập — theo đúng để nhất quán

- **Luôn** `node --check <file>.js` sau khi sửa JS trước khi làm gì tiếp.
- **Luôn** bump `?v=NNNN` (sed replace toàn bộ trong `index.html`) trước khi deploy có sửa code — nếu không CDN cache bản cũ.
- **Luôn** test sống qua Claude Browser pane (`preview_start` name `NhopNhep`, port 5557) TRƯỚC khi deploy — đặc biệt với thay đổi UI, phải chụp ảnh/đọc DOM xác nhận, không chỉ đoán.
- Quy trình deploy chuẩn: sửa code → syntax check → bump version → test local → `git add -A && git commit` (message tiếng Anh, mô tả kỹ WHY không chỉ WHAT) → `git push origin master` → `npx wrangler pages deploy . --project-name=nhopnhep --branch=master --commit-dirty=true` → `curl` xác nhận production đã lên bản mới.
- Commit message: tiếng Anh, có ngữ cảnh đầy đủ (không chỉ "fix bug"), kết thúc bằng `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- i18n: mọi string tiếng Việt hiển thị cho user PHẢI qua `I18N.t('key')`, thêm key ở CẢ 2 khối `vi`/`en` trong `js/i18n.js`. String trong PROMPT gửi cho Gemini thì KHÔNG cần i18n (AI luôn nhận prompt tiếng Việt, chỉ output mới cần đúng ngôn ngữ vùng miền).
- Trước khi thử lại "proxy Gemini qua Cloudflare Function" — ĐỌC comment đầu file `functions/api/gemini-search.js` trước, đã có người thử và thất bại vì lý do hạ tầng (Cloudflare routes VN traffic qua Hong Kong, Gemini chặn Hong Kong), không phải lỗi code.

---

## 7. Đã bàn hướng nhưng CHƯA làm (để tham khảo khi cần tiếp tục)

Từ buổi bàn "làm cộng đồng giống mạng xã hội hơn", có 4 hướng, người dùng chỉ chọn làm hướng feed ảnh (đã xong, mục 3). 3 hướng còn lại, nếu muốn làm tiếp:

- **Hồ sơ cá nhân đậm hơn**: bio riêng (hiện dùng tagline tĩnh chung "Fan của quán ngon 🍴" cho mọi người), ảnh bìa. Effort thấp.
- **Dòng thời gian hoạt động thật** (không chỉ feed liệt kê bài đăng theo `-created` như hiện tại, mà một feed ưu tiên hoạt động của người bạn follow): PocketBase có sẵn realtime (SSE), không cần thêm hạ tầng.
- **Bình luận + thông báo trong app** (người dùng đã chọn: chỉ cần badge trong app, KHÔNG cần push notification — nếu làm push thì cần thêm Service Worker, đồng thời mở khoá luôn khả năng offline cho PWA, nhưng là thay đổi lớn hơn nên để sau). Cần collection `comments` mới.

---

## 8. Tài liệu liên quan đã có

- `PROJECT_HANDOFF.md` — chính là file này.
- `README.md` — **RẤT CŨ** (viết ngày đầu dự án 2026-08-23), mô tả sai kiến trúc hiện tại (nói "1 file index.html", không nhắc AI/cộng đồng/song ngữ, hướng dẫn deploy Netlify trong khi thực tế dùng Cloudflare Pages). Nên viết lại hoặc xoá — chưa làm vì ngoài phạm vi yêu cầu lần này.
- `NhopNhep-docs/` (thư mục riêng) — có sẵn `NhopNhep-TongQuan`, `NhopNhep-LoTrinh`, `NhopNhep-BaoCaoTienDo` (html+pdf) — CHƯA kiểm tra độ mới, có thể cũng đã cũ, nên đối chiếu lại nếu dùng.
- Bản pitch deck nhà đầu tư (VI+EN, PDF) đã tạo trong phiên làm việc này — chứa nghiên cứu thị trường Đông Nam Á/Việt Nam có trích nguồn thật (Momentum Works, e-Conomy SEA, Do Ventures/NIC/VPCA/BCG...) và khung định giá tham khảo — hữu ích nếu cần lại số liệu thị trường mà không muốn research lại từ đầu. File nằm ở scratchpad phiên làm việc lúc đó, không nằm trong repo — nếu cần lại, phải tạo mới.

---

## 9. Bối cảnh cạnh tranh (tóm tắt nhanh, chi tiết đầy đủ trong pitch deck)

Không thiếu người chơi lớn (ShopeeFood/GrabFood ~95% thị phần giao đồ ăn VN, Google Maps, TikTok) nhưng không ai chiếm trọn khoảng trống "quyết định nhanh + tự lên lịch trình + cộng đồng thật". Đối thủ gần nhất về Ý TƯỞNG là các app random quán ăn nhỏ lẻ toàn cầu (Wheel of Food...) và đặc biệt — **`truanayangi.com`** (đã tìm thấy trong phiên này) — 1 app Việt Nam cùng ý tưởng "trưa nay ăn gì", nhưng đi hướng cực đơn giản (client-only, không AI, không backend, mã nguồn mở cộng đồng). Nếu có nhà đầu tư hỏi về đối thủ Việt Nam, đây là cái tên cần biết.

---

## 10. Việc nên làm ngay tiếp theo (nếu phải chọn 3 việc)

1. **Quyết định mô hình doanh thu** hoặc ít nhất gắn analytics để có số liệu thật trước khi quyết định — hiện đang hoàn toàn "bay mù" không biết ai dùng app.
2. **Nâng cấp Gemini API lên gói trả phí** (rẻ, theo lượng dùng) trước khi push công khai rộng rãi — quota miễn phí hiện tại quá nhỏ so với 1 bài đăng lan truyền.
3. **Viết lại `README.md`** cho khớp thực tế hiện tại (đang sai gần như hoàn toàn) — ảnh hưởng trực tiếp đến việc người khác (kể cả 1 Claude session khác) hiểu đúng dự án khi mới vào.
