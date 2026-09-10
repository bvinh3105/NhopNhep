# Nhóp Nhép — Tài liệu bàn giao dự án

> Viết ngày 2026-09-10, cập nhật lớn 2026-09-11 (sau ~3 tuần phát triển).
> Mục đích: để một phiên Claude khác (hoặc chính bạn sau này) đọc 1 file này là nắm được toàn bộ bối cảnh, không cần hỏi lại từ đầu.

---

## 1. Dự án là gì

**Nhóp Nhép** — PWA giải quyết câu hỏi "hôm nay ăn gì?" bằng cách: quét quanh vị trí thật → AI + dữ liệu bản đồ mở trả về danh sách quán → xáo ngẫu nhiên (chống phân tích liệt não) → chọn tối đa 6 quán → tự động dựng lịch trình đa điểm có tính giờ + dẫn đường thật. Có thêm lớp cộng đồng nhỏ (đăng quán, follow, vote) kiểu mạng xã hội nhẹ.

**Không phải** app đặt/giao đồ ăn. **Không phải** app review/tìm kiếm thuần tuý. Xem thêm phần định vị cạnh tranh trong bản pitch deck (mục 9).

- **Live**: https://nhopnhep.pages.dev
- **Repo**: `bvinh3105/NhopNhep` (private), nhánh `master`
- **Deploy**: Cloudflare Pages **Direct Upload** — `git push` KHÔNG tự deploy, phải chạy `npx wrangler pages deploy . --project-name=nhopnhep --branch=master --commit-dirty=true` sau mỗi lần push.
- **Cache-busting hiện tại**: `v=2495` — mọi `<script>`/`<link>` trong `index.html` đều có `?v=NNNN`, phải bump số này (sed replace toàn bộ) trước mỗi lần deploy có sửa code, nếu không CDN/trình duyệt sẽ giữ bản cũ.
- **Tunnel URL (Community backend)**: `https://decreased-subject-multimedia-wolf.trycloudflare.com` — Quick Tunnel, đổi mỗi lần cloudflared restart. Có mặt TRONG CẢ HAI file: `js/community.js` (`DEFAULT_URL`) và `functions/api/log.js` (`PB_URL`). Khi tunnel rotate, **phải bump URL trong CẢ 2 file** cùng nhau — watchdog hiện chỉ tự sửa file đầu, xem mục 4.

---

## 2. Kiến trúc & tech stack

Vanilla HTML/CSS/JS thuần — **không** framework, **không** build step, **không** `package.json` cho frontend. 14 file `js/*.js` load tuần tự qua thẻ `<script>` trong `index.html` (thứ tự phụ thuộc: `security.js` → `i18n.js` → `utils.js` → `state.js` → `poi.js` → `geocoder.js` → `gemini.js` → `community.js` → `analytics.js` → `map.js` → `gps.js` → `locationPicker.js` → `controllers.js` → `app.js`).

| File | Vai trò |
|---|---|
| `app.js` | Boot sequence, event listener toàn cục (i18n:changed, community:session-expired), deep-link handler (`?q=<pb_id>`), Analytics.boot() |
| `controllers.js` | **File lớn nhất** — toàn bộ UI controller (HomeCtrl, ResultsCtrl, PlanCtrl, ProfileCtrl, CommunityCtrl, các Modal) |
| `community.js` | Client API cho PocketBase (auth, CRUD quán, vote, friends/follow, avatar) |
| `gemini.js` | Gọi Gemini AI trực tiếp từ browser (`gemini-flash-lite-latest`) |
| `poi.js` | Parse dữ liệu Overpass (OSM) thành object quán |
| `geocoder.js` | Photon (Komoot) — autocomplete địa chỉ + reverse geocode |
| `analytics.js` | Custom event tracking — session_id UUID trong localStorage, sendBeacon + keepalive fallback, POST vào `/api/log` proxy (KHÔNG post trực tiếp lên tunnel — ad blocker chặn cross-origin). 7 event: `app_open` `scan` `plan_built` `detail_open` `add_quán` `login`/`register` `follow`. Opt-out: `localStorage.setItem('analytics_disabled','1')`. Skip localhost. |
| `map.js` / `gps.js` / `locationPicker.js` | Leaflet map, GPS tracking, chọn vị trí trên map |
| `i18n.js` | Engine song ngữ VI/EN (dictionary phẳng key→string) |
| `state.js` | State toàn cục + persist localStorage + export/import JSON. Bao gồm `savedPosts` (Set<pb_id>) — bookmark quán community. |
| `utils.js` | `CATEGORIES`, `parseOpeningHours`, `timeAgo`, `authorAvatar`, escape helpers, `allRestaurants()` (gộp user + osm + community pools cho scan) |
| `security.js` | Chặn devtools/right-click cơ bản (tự nhận là "bypass được trong vài giây", chỉ mang tính ngăn cản nhẹ). Đã bỏ shield DevTools window-size-detect vì false positive trên mobile chrome UI collapse. |

**Functions (Cloudflare Pages, `functions/api/`)**:
- `overpass.js` — proxy + đua 3 mirror Overpass + cache edge 5 phút. **Đang dùng, hoạt động tốt.**
- `log.js` — same-origin proxy cho analytics beacon (POST → PocketBase `analytics_events`). Same-origin để ad blocker/tracking protection không match được (verified 2026-09-10: cross-origin sendBeacon với URL chứa "analytics_events" bị mọi ad blocker chặn silent, 0 event thu được từ browser trong khi curl server-side work). **PB_URL hardcode trong file này — phải cập nhật cùng lúc với `js/community.js` khi tunnel rotate.**
- `gemini-search.js` — **DORMANT, không dùng.** Từng thử proxy+cache Gemini qua đây để tiết kiệm quota, nhưng phát hiện Cloudflare chạy Function cho traffic từ Việt Nam ở trạm Hong Kong, mà Gemini API chặn cứng request từ Hong Kong. Đã revert, giữ lại file kèm comment giải thích để không tốn công thử lại. Xem commit `1c875bf`.

**External APIs** (miễn phí, không có SLA chính thức — xem mục "Rủi ro hạ tầng"):
- Gemini API (`gemini-flash-lite-latest`) — key dùng chung (embedded, fragment trong `gemini.js`) + tuỳ chọn key riêng người dùng tự thêm. Free tier ước tính ~1.000-1.500 request/ngày CHUNG cho toàn app.
- OpenStreetMap Overpass — dữ liệu quán khi không dùng AI hoặc AI thất bại.
- Photon (Komoot) — autocomplete địa chỉ.
- OSRM public demo server (`router.project-osrm.org`) — dẫn đường thật; có fallback về đường thẳng nếu lỗi.

**Backend cộng đồng**: PocketBase v0.40.3, tự host **trên chính máy tính cá nhân của bạn** (không phải VPS), tunnel ra ngoài qua Cloudflare Quick Tunnel (URL đổi mỗi lần restart). Chi tiết đầy đủ ở mục 4.

---

## 3. Tính năng đã có (đều đã test thật, không phải mock)

**Quét & tìm quán**: GPS live hoặc gõ địa chỉ · 4 danh mục · bán kính 500m-5km · tìm theo tên món/quán cụ thể · lọc rating tối thiểu · 3 nguồn dữ liệu (🌐 Địa điểm công khai/OSM · ⭐ Của tôi · 👥 Cộng đồng) — đua song song Gemini + OSM, ai xong trước thắng (trừ tìm theo tên/món thì merge cả 2 nguồn) · Community source fetch parallel qua `Community.listRestaurants` và adapt về shape chung của app · random hoá kết quả mỗi lần quét.

**AI hiểu vùng miền**: Gemini tự suy luận quốc gia/thành phố thật từ GPS thay vì mặc định Việt Nam, tự đổi định dạng tiền tệ/địa chỉ theo vùng. (Nhánh OSM-only vẫn CHƯA làm được việc này — xem mục 5.)

**Lên lịch trình**: nearest-neighbor sắp thứ tự điểm, dwell time mặc định theo danh mục, tốc độ di chuyển giả định xe máy (~25km/h), điều chỉnh dwell ±5 phút cascade toàn bộ giờ sau đó, dẫn đường thật bám mặt đường (OSRM) + theo dõi vị trí sống, lịch sử chuyến + "đi lại" từ vị trí hiện tại.

**Cá nhân — Instagram-style profile (redesign 2026-09-11)**:
- Không còn 4 stat card local + local hero riêng. Community identity header (avatar to giữa · username · tagline · 3 stats: posts/stars/followers) là ONE identity block duy nhất.
- Top-right có 2 icon: **⚙️ Cài đặt** (accountModal — avatar picker, tên, ngôn ngữ, sở thích, bạn bè · Data + Gemini AI ẩn theo yêu cầu, code giữ) và **🔖 Quán đã lưu** (mở SavedListModal).
- Filter tabs "Tất cả / Nhà hàng / Vỉa hè / Ăn vặt / Cà phê" nằm dưới community header, list là social-grid 3 cột như Instagram.

**Cộng đồng — browse-first cho guest**:
- Feed kiểu Instagram: avatar + tên + thời gian tương đối + carousel ảnh vuốt được (tối đa 4 ảnh) + nút ♥ + caption + tag/hashtag.
- **Khách vãng lai (chưa login)** vào tab thấy ngay 10 quán mới nhất (`GUEST_CAP=10`), không bị chặn bởi auth form. Nút "Đăng nhập" nhỏ ở top-right header (dùng chung slot `.add-btn` với "+ Đăng quán" — chỉ hiện 1 trong 2 tuỳ trạng thái) → mở auth form; form có link "← Xem quán trước" để quay lại browse. Search box + "+ Đăng quán" chỉ hiện khi login.
- Lưới hồ sơ 3 cột (Quán của tôi + xem hồ sơ người khác) + header avatar/tên/3 số liệu (quán đã đăng/★ nhận được/follower — follower count tính thật qua field `friends`).
- Đăng quán: tên, danh mục, giá, mô tả, vị trí (map picker), tối đa 4 ảnh (nén WebP client-side), tag tự do + hashtag riêng, 3 mức riêng tư (private/friends/public).
- Follow 1 chiều kiểu Twitter (field `friends` trên `users`, không cần đối phương chấp nhận).
- Sửa/xoá quán của mình qua modal chi tiết (bấm vào quán → nếu là chủ thì hiện nút Sửa/Xoá thay vì tác giả+tim).
- **"Cùng 1 quán" — liên kết nhẹ giữa các bài trùng (2026-09-11)**: nhiều người đăng cùng 1 quán ngoài đời thật (vd nhiều người cùng đăng "WeGo Trích Sài") giờ có thể liên kết lại thay vì hiện thành nhiều bài rời rạc. Field `linked_to` (self-relation, `restaurants`) — người đăng TỰ xác nhận, KHÔNG BAO GIỜ tự động gán. Lúc điền tên+vị trí trong form đăng quán, tự so khớp (tên bỏ dấu/hoa-thường chứa nhau + trong 80m) với quán mình VỐN ĐÃ có quyền xem, hỏi xác nhận nếu tìm thấy. Hiển thị gộp chia 2 tầng: feed tính rẻ trên dữ liệu đã tải sẵn (không gọi thêm API), modal chi tiết gọi 1 truy vấn riêng lấy chính xác toàn bộ nhóm. Toàn bộ đều đi qua `Community.listRestaurants()` sẵn có nên KHÔNG mở đường rò rỉ riêng tư mới — chỉ gộp những gì người xem vốn đã thấy được. Xem `Community.findSimilarNearby()`/`getLinkedGroup()`/`resolveRootId()` trong `js/community.js`.
- **Bookmark + Copy link** (2 nút trong CommunityDetailModal, phía trên Đóng/Google Maps): 🔖 Lưu (toggle vào `State.savedPosts` — localStorage per browser, không cần login) · 📋 Sao chép link (clipboard `nhopnhep.pages.dev/?q=<pb_id>` — deep-link handler trong `app.js:boot()` đọc `?q=` và auto-open CommunityDetailModal cho quán đó sau 400ms).
- Avatar emoji đồng bộ lên server (`avatar_emoji` field trên users, xem mục 4).

**Analytics / observability (2026-09-10)**:
- Custom event tracking → PocketBase collection `analytics_events` (schema mục 4). 7 event lifecycle: `app_open` (boot) · `scan` (props: radius/cats/srcs/has_dish/min_rating) · `plan_built` (stops, replay flag) · `detail_open` (source: osm/gemini/community/mine + has_image/has_coords) · `add_quán` (cat, price, visibility, photo/tag/hashtag counts) · `login`/`register` · `follow`.
- Đi qua `/api/log` Cloudflare Function (same-origin) chứ KHÔNG post trực tiếp lên tunnel — verified: cross-origin sendBeacon với URL chứa "analytics_events" bị mọi ad blocker + tracking protection chặn silent (0 event thu được từ browser), same-origin thì immune.
- Slot cho **Cloudflare Web Analytics** đã sẵn trong `<head>` của index.html (comment). Chỉ cần vào `dash.cloudflare.com > Web Analytics > Add site > nhopnhep.pages.dev > copy beacon script` rồi uncomment + paste token. Chưa gắn — thấy mục 10.
- Session identity: crypto.randomUUID() lưu localStorage `analytics_session_id`, vĩnh viễn cho browser đó. Khi login, `user_id` join thêm trên top (không thay session_id). Đếm unique visitor = unique session_id; DAU = unique session_id có event trong ngày.

**Song ngữ VI/EN**: toàn app, ~330 key (thêm gần 30 key trong 2 ngày cuối), đổi ngôn ngữ tức thời không reload, chọn trong modal Tài khoản.

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
- **Migration**: `1725700007_add_user_avatar.js` (field `avatar_emoji` trên `users`) + `1725700008_add_restaurant_linked_to.js` (field `linked_to`, self-relation trên `restaurants` — xem mục 3 "Cùng 1 quán"). Cả 2 đã áp dụng live bằng cách restart PocketBase (không cần đụng tunnel).
- **Collection `analytics_events`** (tạo qua Admin UI 2026-09-10, KHÔNG có migration file — nếu setup lại PocketBase ở máy khác phải tạo lại thủ công qua Admin UI):
  - Fields: `event` (text, required, indexed, Presentable, max 40) · `session_id` (text, required, indexed, max 40) · `user_id` (relation → users, nullable, single, indexed) · `props` (json) · `is_guest` (bool) · `ua` (text, max 200) · `referrer` (text, max 200) · `created` (autodate on Create) · `updated` (autodate on Create/Update).
  - Indexes: `idx_ae_event`, `idx_ae_session`, `idx_ae_user`, `idx_ae_created`.
  - **API rules quan trọng**: List/View/Update/Delete = superusers only. **Create = EMPTY string** (không phải null, không phải "superusers only") — để anonymous browser POST được. Nếu Create = superusers-only, browser sẽ 403 và 0 event thu được. Xem debug trip 2026-09-10 nếu quên rule này lần nữa.
- **Superuser**: email/password nằm trong `README.md` của thư mục community-server (đã đổi 1 lần sau khi phát hiện lộ qua tunnel công khai — xem CHANGELOG/README ở đó, KHÔNG chép lại ở đây).
- Dữ liệu thật hiện tại: rất ít (3 quán cộng đồng, vài chục KB) — quy mô còn rất sớm.

**Watchdog bug — ĐÃ FIX phần 2/3, còn 1/3 chưa root-cause** — phát hiện 2026-09-10 19:05, fix phần coordination 2026-09-11:
- Sự cố gốc: `NhopNhep-Watchdog` phát hiện tunnel `dice-impressed-historical-internet` chết, spawn tunnel mới `decreased-subject-multimedia-wolf` thành công (log "URL tunnel moi: ..." xuất hiện), NHƯNG dừng ngang không tiếp tục bump cache version + git commit/push + wrangler deploy như các lần trước. Phải fix tay lần đó.
- **Đã fix**: cả `Bat-TOAN-BO-Auto.ps1` (watchdog) và `Bat-TOAN-BO.ps1` (script thủ công) giờ ĐỀU cập nhật `functions/api/log.js` PB_URL song song với `js/community.js` DEFAULT_URL mỗi khi tunnel rotate — không còn phải nhớ sửa tay 2 chỗ nữa. Đã test script watchdog chạy sạch (no-op khi khoẻ, không lỗi).
- **CHƯA root-cause**: lý do script dừng ngang giữa chừng lần đó (không tiếp tục bump version/commit/deploy) vẫn chưa rõ — nghi ngờ ban đầu (wrangler cần interactive auth, hoặc script không biết log.js) chỉ đúng 1 phần (thiếu log.js đã fix), phần "dừng ngang" gốc có thể là nguyên nhân khác (transient network lúc đó, hoặc git/wrangler timeout) chưa tái hiện lại được để xác nhận. Nếu thấy watchdog log dừng giữa chừng lần nữa (có dòng "URL tunnel moi" nhưng không có "DA TU PHUC HOI XONG"), xem `last-deploy.log`/`quicktunnel.log` lúc đó để tìm nguyên nhân thật.

**Điều CHƯA làm dù đã khuyến nghị** (từ chính README của community-server):
- [ ] Viết Privacy Policy
- [ ] Test tunnel qua ít nhất 1 lần restart máy thật (đã test restart process, chưa test restart CẢ MÁY)
- [ ] Cấu hình SMTP thật → nút "Quên mật khẩu"/xác thực email hiện KHÔNG hoạt động (không chặn dùng app, nhưng UX thiếu)

---

## 5. Đã biết còn thiếu / nợ kỹ thuật — ưu tiên xử lý

Xếp theo mức độ quan trọng, không phải thứ tự thời gian:

1. **Không có mô hình doanh thu** — chưa có bất kỳ tích hợp thanh toán/subscription/quảng cáo nào.
2. **Traffic-level analytics chưa gắn** — custom event tracking (business events) đã có (xem mục 3 "Analytics"), nhưng chưa gắn Cloudflare Web Analytics beacon (pageview/geo/vitals — miễn phí, chỉ cần paste 1 script tag vào `<head>`). Placeholder + comment đã sẵn trong `index.html`.
3. **Watchdog stop mid-cycle khi tunnel rotate** — phần "quên update log.js" đã fix 2026-09-11 (cả 2 script giờ tự update cả 2 file). Phần "tại sao dừng ngang" gốc vẫn chưa root-cause — xem mục 4 chi tiết, theo dõi nếu tái diễn.
4. **Quota Gemini dùng chung nhỏ và dễ cạn** (~1.000-1.500 request/ngày CHUNG toàn app) — khi cạn thì tự rớt về OSM (không sập, chỉ kém chính xác hơn). Đã thêm cơ chế "cooldown 3h" để không lãng phí request thử lại vô ích khi biết đã cạn. Giải pháp thật (nâng gói trả phí) CHƯA làm.
5. **Nhánh OSM-only vẫn hardcode giá kiểu VNĐ** ("40k-80k") bất kể vùng thật — phần region-aware chỉ áp dụng cho nhánh Gemini, chưa lan sang OSM.
6. **Không có push notification, không service worker** — dù là PWA, không dùng được offline.
7. **Chưa có tính năng bình luận / hoạt động bạn bè (activity feed)** — đã bàn hướng (xem mục 7 "Đã bàn nhưng chưa làm"), người dùng chọn ưu tiên feed ảnh trước, phần này để sau.
8. **Chưa có hệ thống report/kiểm duyệt nội dung cộng đồng** — quy mô nhỏ nên chưa cấp thiết, nhưng cần trước khi mở rộng nhiều người lạ. Người dùng đã chọn Phase 1 = frontend only (bookmark, copy link — đã làm 2026-09-11); Phase 2 = chặn user + báo cáo bài (chưa làm, cần thêm collection `reports` + field `blocked_users` trên `users`).
9. **Backend tự host trên máy cá nhân** — dù đã có backup + watchdog tự phục hồi, vẫn là 1 điểm-lỗi-duy-nhất về mặt vật lý (máy tắt hẳn/hỏng ổ = mất hết, dù backup giảm thiểu rủi ro mất dữ liệu). Khuyến nghị dài hạn: chuyển sang VPS nhỏ (~$4-6/tháng) khi có ngân sách — theo README của community-server, việc này chỉ là copy `pocketbase.exe` + `pb_data/` sang, không cần sửa code.
10. **1 người phát triển duy nhất** — rủi ro key-person, không có ai backup kiến thức nếu bạn vắng mặt (tài liệu này một phần để giảm thiểu rủi ro đó).
11. **Key Gemini dùng chung nhúng trong client** (dù đã fragment + giới hạn theo hostname) — không phải bí mật thật, chỉ là rào cản nhẹ. Từng bị lộ mật khẩu PocketBase qua tunnel công khai 1 lần (đã phát hiện + đổi).

---

## 6. Quy ước làm việc đã thiết lập — theo đúng để nhất quán

- **Luôn** `node --check <file>.js` sau khi sửa JS trước khi làm gì tiếp.
- **Luôn** bump `?v=NNNN` (sed replace toàn bộ trong `index.html`) trước khi deploy có sửa code — nếu không CDN cache bản cũ.
- **Luôn** test sống qua Claude Browser pane (`preview_start` name `NhopNhep`, port 5557) TRƯỚC khi deploy — đặc biệt với thay đổi UI, phải chụp ảnh/đọc DOM xác nhận, không chỉ đoán.
- Quy trình deploy chuẩn: sửa code → syntax check → bump version → test local → `git add -A && git commit` (message tiếng Anh, mô tả kỹ WHY không chỉ WHAT) → `git push origin master` → `npx wrangler pages deploy . --project-name=nhopnhep --branch=master --commit-dirty=true` → `curl` xác nhận production đã lên bản mới.
- **Khi Cloudflare tunnel rotate** (mỗi lần cloudflared restart, URL đổi): cả 2 file cần URL mới — `js/community.js` (`DEFAULT_URL`) và `functions/api/log.js` (`PB_URL`). Từ 2026-09-11, cả watchdog VÀ script thủ công đều tự cập nhật ĐỦ CẢ 2 file + bump version + deploy — không cần nhớ sửa tay nữa (trừ khi gặp lại bug "dừng ngang" chưa root-cause ở mục 4, lúc đó vẫn phải kiểm tra tay).
- Commit message: tiếng Anh, có ngữ cảnh đầy đủ (không chỉ "fix bug"), kết thúc bằng `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` hoặc `Claude Opus 4.7`, tuỳ model đang dùng.
- i18n: mọi string tiếng Việt hiển thị cho user PHẢI qua `I18N.t('key')`, thêm key ở CẢ 2 khối `vi`/`en` trong `js/i18n.js`. String trong PROMPT gửi cho Gemini thì KHÔNG cần i18n (AI luôn nhận prompt tiếng Việt, chỉ output mới cần đúng ngôn ngữ vùng miền).
- Trước khi thử lại "proxy Gemini qua Cloudflare Function" — ĐỌC comment đầu file `functions/api/gemini-search.js` trước, đã có người thử và thất bại vì lý do hạ tầng (Cloudflare routes VN traffic qua Hong Kong, Gemini chặn Hong Kong), không phải lỗi code.
- **Analytics** — nếu thêm event mới, gọi `Analytics.track('<snake_case_event>', { ...props })` ở nơi có ý nghĩa business (không spam mỗi render). `_sanitizeProps` chỉ chấp nhận number/bool/string ≤60ch/array-of-scalars — không leak PII/free-text/toạ độ vào props. Tránh event có "analytics" trong name (redundant); dùng verb ngắn kiểu `scan`, `add_quán`, `follow`.
- **Modal stacking** — mọi modal-overlay mới phải hoặc auto-close khi tab bar chuyển tab (`TabNav.switchTo` đã lo), hoặc explicitly close modal chain (`SavedListModal → CommunityDetailModal` closes savedList trước). Verified bug 2026-09-11: nested modals looked broken.

---

## 7. Đã bàn hướng nhưng CHƯA làm (để tham khảo khi cần tiếp tục)

Từ buổi bàn "làm cộng đồng giống mạng xã hội hơn", có 4 hướng, người dùng chỉ chọn làm hướng feed ảnh (đã xong, mục 3). 3 hướng còn lại, nếu muốn làm tiếp:

- **Hồ sơ cá nhân đậm hơn**: bio riêng (hiện dùng tagline tĩnh chung "Fan của quán ngon 🍴" cho mọi người), ảnh bìa. Effort thấp.
- **Dòng thời gian hoạt động thật** (không chỉ feed liệt kê bài đăng theo `-created` như hiện tại, mà một feed ưu tiên hoạt động của người bạn follow): PocketBase có sẵn realtime (SSE), không cần thêm hạ tầng.
- **Bình luận + thông báo trong app** (người dùng đã chọn: chỉ cần badge trong app, KHÔNG cần push notification — nếu làm push thì cần thêm Service Worker, đồng thời mở khoá luôn khả năng offline cho PWA, nhưng là thay đổi lớn hơn nên để sau). Cần collection `comments` mới.
- **Menu 3-chấm trên post (Phase 2 — cần backend)**: kill user + báo cáo bài. Cần field `blocked_users` (relation array) trên `users` để listRule filter, và collection mới `reports` (post_id, reporter_id, reason, at) — superuser review qua Admin UI. Phase 1 (bookmark, copy link — frontend only) đã xong 2026-09-11. Ban đầu bàn thêm "Không quan tâm" (hide post) + "Tắt thông báo" (mute user) nhưng người dùng chỉ chọn 2 cái làm được ngay.

---

## 8. Tài liệu liên quan đã có

- `PROJECT_HANDOFF.md` — chính là file này.
- `README.md` — **đã viết lại cùng ngày với file này (2026-09-10)**, khớp với thực tế hiện tại: kiến trúc 13 module JS, tech stack (Gemini + OSM + Photon + OSRM + PocketBase), deploy Cloudflare Pages Direct Upload, quy trình bump `?v=NNNN`, hướng dẫn chạy local. Nội dung là bản rút gọn của file này (~140 dòng vs 154 dòng của HANDOFF), dùng làm entry point cho người mới; cần bối cảnh sâu vẫn dẫn về file này.
- `NhopNhep-docs/` (thư mục riêng) — có sẵn `NhopNhep-TongQuan`, `NhopNhep-LoTrinh`, `NhopNhep-BaoCaoTienDo` (html+pdf) — CHƯA kiểm tra độ mới, có thể cũng đã cũ, nên đối chiếu lại nếu dùng.
- Bản pitch deck nhà đầu tư (VI+EN, PDF) đã tạo trong phiên làm việc này — chứa nghiên cứu thị trường Đông Nam Á/Việt Nam có trích nguồn thật (Momentum Works, e-Conomy SEA, Do Ventures/NIC/VPCA/BCG...) và khung định giá tham khảo — hữu ích nếu cần lại số liệu thị trường mà không muốn research lại từ đầu. File nằm ở scratchpad phiên làm việc lúc đó, không nằm trong repo — nếu cần lại, phải tạo mới.

---

## 9. Bối cảnh cạnh tranh (tóm tắt nhanh, chi tiết đầy đủ trong pitch deck)

Không thiếu người chơi lớn (ShopeeFood/GrabFood ~95% thị phần giao đồ ăn VN, Google Maps, TikTok) nhưng không ai chiếm trọn khoảng trống "quyết định nhanh + tự lên lịch trình + cộng đồng thật". Đối thủ gần nhất về Ý TƯỞNG là các app random quán ăn nhỏ lẻ toàn cầu (Wheel of Food...) và đặc biệt — **`truanayangi.com`** (đã tìm thấy trong phiên này) — 1 app Việt Nam cùng ý tưởng "trưa nay ăn gì", nhưng đi hướng cực đơn giản (client-only, không AI, không backend, mã nguồn mở cộng đồng). Nếu có nhà đầu tư hỏi về đối thủ Việt Nam, đây là cái tên cần biết.

---

## 10. Việc nên làm ngay tiếp theo (nếu phải chọn 3 việc)

1. **Gắn Cloudflare Web Analytics beacon** (pageview/geo/vitals) — 5 phút việc: `dash.cloudflare.com > Web Analytics > Add site > nhopnhep.pages.dev > copy script tag > paste vào slot commented sẵn trong `<head>` của `index.html`. Custom event tracking (business layer) đã chạy sang PocketBase; đây là mảnh còn thiếu để hiểu top-of-funnel (traffic + bounce + geography).
2. **Quyết định mô hình doanh thu** — giờ đã có custom event data để nhìn (`analytics_events` trong PB Admin, filter `event="scan"` etc), có thể xem trước data 1-2 tuần để hiểu behavior thật trước khi commit.
3. **Nâng cấp Gemini API lên gói trả phí** (rẻ, theo lượng dùng) trước khi push công khai rộng rãi — quota miễn phí hiện tại quá nhỏ so với 1 bài đăng lan truyền.
4. ~~Dạy watchdog update `functions/api/log.js`~~ — **đã fix 2026-09-11**. Còn lại: root-cause tại sao lần đó script dừng ngang giữa chừng (xem mục 4) nếu nó tái diễn.
