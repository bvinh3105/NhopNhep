# Nhóp Nhép — Tài liệu bàn giao dự án

> Viết ngày 2026-09-10, cập nhật lớn 2026-09-11, cập nhật lớn 2026-09-14, **cập nhật lớn 2026-09-16** (sau ~1 tháng phát triển).
> Mục đích: để một phiên Claude khác (hoặc chính bạn sau này) đọc 1 file này là nắm được toàn bộ bối cảnh, không cần hỏi lại từ đầu.
> **Nếu bạn đọc file này sau 2026-09-16 quá vài ngày**: chạy `git log --oneline <commit cuối bạn biết>..HEAD` trước. Đừng tin ngày "cập nhật lớn" ở trên là luôn đủ mới.
>
> **Đọc mục 3.5** nếu cần biết về tính năng "Phiên chọn quán theo nhóm" (Group Session) — **ĐÃ SHIP** (commit `112bbbe`, 2026-09-16), nhưng review adversarial bị cắt ngang giữa chừng (session limit) nên chỉ 2/5 lens kịp chạy trước khi ship — xem mục 3.5 để biết chính xác phần nào đã verify, phần nào CHƯA, và test thủ công còn thiếu (happy-path vote thật — Turnstile chặn Claude tự tạo tài khoản test).

---

## 1. Dự án là gì

**Nhóp Nhép** — PWA giải quyết câu hỏi "hôm nay ăn gì?" bằng cách: quét quanh vị trí thật → AI + dữ liệu bản đồ mở trả về danh sách quán → xáo ngẫu nhiên (chống phân tích liệt não) → chọn tối đa 6 quán → tự động dựng lịch trình đa điểm có tính giờ + dẫn đường thật (giờ có navigation thật: heading-up, off-route reroute — xem mục 3). Có thêm lớp cộng đồng nhỏ (đăng quán, follow, vote) kiểu mạng xã hội nhẹ.

**Không phải** app đặt/giao đồ ăn. **Không phải** app review/tìm kiếm thuần tuý. Xem thêm phần định vị cạnh tranh trong bản pitch deck (mục 9).

- **Live**: https://nhopnhep.pages.dev
- **Repo**: `bvinh3105/NhopNhep` (private), nhánh `master`
- **Deploy**: Cloudflare Pages **git-connected auto-deploy** — **ĐÃ ĐỔI từ Direct Upload** (không rõ chính xác lúc nào, phát hiện lại 2026-09-14). `git push origin master` là ĐỦ — Cloudflare tự build+deploy trong vài giây, xác nhận bằng `npx wrangler pages deployment list --project-name=nhopnhep` (deployment mới xuất hiện "just now" khớp đúng commit hash). **KHÔNG cần chạy `wrangler pages deploy` thủ công nữa** — các hướng dẫn cũ trong file này/README nói phải chạy lệnh đó là **SAI**, chỉ còn đúng nếu ai đó tắt git integration đi. Nếu nghi ngờ, `wrangler pages deployment list` là cách xác nhận nhanh nhất.
- **Cache-busting hiện tại**: `v=2611` (2026-09-16) — mọi `<script>`/`<link>` trong `index.html` đều có `?v=NNNN`, phải bump số này (sed replace toàn bộ) trước mỗi lần deploy có sửa code, nếu không CDN/trình duyệt sẽ giữ bản cũ. Xem mục 6 cho 1 bug đã gặp: PowerShell `Get-Content`/`Set-Content` mặc định phá encoding UTF-8 tiếng Việt khi bump version — dùng `sed` (Bash tool) hoặc `-Encoding utf8` rõ ràng. Số này thay đổi RẤT thường xuyên (watchdog tự bump mỗi lần tunnel rotate) — coi số cụ thể ở đây là tham khảo, luôn `grep -oE "v=[0-9]+" index.html` để lấy số thật trước khi bump tiếp.
- **Tunnel URL (Community backend)**: đổi liên tục, đừng tin số ghi cứng ở đây — luôn `grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" js/community.js` để lấy URL thật. Có mặt trong **BỐN** file: `js/community.js` (`DEFAULT_URL`), `functions/api/log.js` (`PB_URL`), `functions/api/register.js` (`PB_URL`), `functions/api/error-report.js` (`PB_URL`).
  - **🐛 Bug nghiêm trọng phát hiện + fix 2026-09-16**: CẢ HAI script (`Bat-TOAN-BO.ps1` thủ công VÀ `Bat-TOAN-BO-Auto.ps1` watchdog) có cùng 1 bug — dòng `git add $communityJs $logJs $indexHtml` tham chiếu biến `$logJs` **CHƯA TỪNG ĐƯỢC GÁN**. Hậu quả: `register.js`/`log.js`/`error-report.js` được patch ĐÚNG trên đĩa mỗi lần tunnel rotate, nhưng KHÔNG BAO GIỜ được commit — production giữ nguyên URL cũ (có thể đã CHẾT) cho 3 file này trong khi `community.js`/`index.html` vẫn đúng. Đã xác nhận thực tế: `register.js` deploy production trỏ tunnel URL chết (`curl` trả `000`) trong khi tunnel thật đang chạy URL khác — nghĩa là **đăng ký tài khoản bị 502 ngẫu nhiên** suốt 1 thời gian dài, độc lập với bug Turnstile (mục 3 "Bảo mật"). Đã fix cả 2 script (đổi `$logJs` → mảng `$patchedFunctionPaths` build động từ danh sách file thật đã patch). Nếu bạn thấy đăng ký lại lỗi 502 "Không kết nối được server cộng đồng" hàng loạt, **kiểm tra `functions/api/register.js`'s PB_URL có khớp tunnel đang chạy không** trước khi nghi ngờ chỗ khác.

---

## 2. Kiến trúc & tech stack

Vanilla HTML/CSS/JS thuần — **không** framework, **không** build step, **không** `package.json` cho frontend. 14 file `js/*.js` load tuần tự qua thẻ `<script>` trong `index.html` (thứ tự phụ thuộc: `security.js` → `i18n.js` → `utils.js` → `state.js` → `poi.js` → `geocoder.js` → `gemini.js` → `community.js` → `analytics.js` → `map.js` → `gps.js` → `locationPicker.js` → `controllers.js` → `app.js`).

| File | Vai trò |
|---|---|
| `app.js` | Boot sequence, event listener toàn cục (i18n:changed, community:session-expired), deep-link handler (`?q=<pb_id>`), Analytics.boot(), **crash reporter IIFE** (`initCrashReporter`, ~dòng 106-157 — bắt `window.error`/`unhandledrejection`, gửi `/api/error-report`, cap 5 report/session) |
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
- `log.js` — same-origin proxy cho analytics beacon (POST → PocketBase `analytics_events`). Same-origin để ad blocker/tracking protection không match được (verified 2026-09-10: cross-origin sendBeacon với URL chứa "analytics_events" bị mọi ad blocker chặn silent, 0 event thu được từ browser trong khi curl server-side work). **PB_URL hardcode trong file này — 1 trong 4 file phải sync khi tunnel rotate, xem mục 1.**
- `register.js` (**mới 2026-09-11, cho Turnstile**) — nhận `{email, password, turnstileToken}`, validate token qua Cloudflare `siteverify` server-side (dùng `env.TURNSTILE_SECRET` — env var/secret, KHÔNG có trong code, fail-closed 500 nếu thiếu), kiểm tra `action==='register'` + hostname nằm trong allowlist cứng (`localhost`/`127.0.0.1`/`nhopnhep.pages.dev`). Chỉ khi pass mới proxy request tạo user thật sang PocketBase. Đây là lớp chặn tạo tài khoản ảo hàng loạt — xem mục 3 "Bảo mật".
- `error-report.js` (**mới 2026-09-12**) — nhận crash report từ `app.js`'s `initCrashReporter`, luôn `console.error('[crash]', ...)` (xem qua CF Dashboard → Deployments → Functions tab → Real-time Logs, filter `[crash]`), best-effort ghi thêm vào PocketBase collection `error_logs` (KHÔNG BẮT BUỘC phải tồn tại — function tự bỏ qua nếu tunnel down/collection chưa tạo). Schema mục 4.
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

**Lên lịch trình**: nearest-neighbor sắp thứ tự điểm, dwell time mặc định theo danh mục, tốc độ di chuyển giả định xe máy (~25km/h), điều chỉnh dwell ±5 phút cascade toàn bộ giờ sau đó, dẫn đường thật bám mặt đường (OSRM).

**Navigation thật khi đang đi (rewrite 2026-09-13, `PlanCtrl` trong controllers.js ~dòng 1272-1638, không phải file riêng)**: 1 nút (`#pmapStart`) chạy vòng 3 trạng thái — **idle** ("Bắt đầu") → tap → **navigating** ("Đang đi") → tap → **paused** ("Tạm dừng") → tap lại → navigating; **long-press ~650ms** ở navigating/paused → kết thúc chuyến về idle. Trong lúc navigating:
- **Heading-up rotation**: hướng xoay bản đồ tính từ độ dời giữa 2 fix GPS liên tiếp, làm mượt bằng exponential smoothing (hệ số 0.35), áp vào map qua `setBearing()` (plugin leaflet-rotate).
- **Off-route + tự route lại**: mỗi fix tính khoảng cách vuông góc tới polyline hiện tại; lệch >40m liên tục 2 fix → hiện banner + tự gọi lại OSRM từ vị trí hiện tại tới các điểm còn lại.
- **Route trimming**: polyline tự cắt phần phía sau điểm chiếu của user mỗi fix, chỉ vẽ đoạn còn lại phía trước.
- **Tới nơi tự động**: trong 30m tính là đã đến, tự nhảy sang điểm kế; điểm cuối thì kết thúc chuyến + toast.

**Lịch sử & lưu chuyến** — 2 khái niệm KHÁC NHAU, đừng nhầm:
- **Lịch sử tự động** (`tripHistory`, `HistoryModal` — "Chuyến ăn đã đi"): mọi lần build lịch trình tự log vào đây, cap 50 gần nhất, không đặt tên được.
- **Lưu chuyến chủ động** (mới, `State.savedTrips`, `PlanCtrl.saveCurrentTrip`/`SavedTripsModal`): user tự đặt tên khi lưu, KHÔNG bao giờ tự xoá, lưu kèm `origin` (toạ độ + label) chụp tại lúc lưu. Mở lại 1 chuyến đã lưu: nếu GPS hiện tại cách origin đã lưu >30km thì dùng origin đã lưu, còn trong 30km thì dùng vị trí GPS thật (đỡ phải "quay lại đúng chỗ cũ" để mở). Chỉ lưu localStorage, không đụng PocketBase.

**Cá nhân — Instagram-style profile (redesign 2026-09-11)**:
- Không còn 4 stat card local + local hero riêng. Community identity header (avatar to giữa · username · tagline · 3 stats: posts/stars/followers) là ONE identity block duy nhất.
- Top-right có 2 icon: **⚙️ Cài đặt** (accountModal — avatar picker, tên, ngôn ngữ, sở thích, bạn bè · Data + Gemini AI ẩn theo yêu cầu, code giữ) và **🔖 Quán đã lưu** (mở SavedListModal).
- Filter tabs "Tất cả / Nhà hàng / Vỉa hè / Ăn vặt / Cà phê" nằm dưới community header, list là social-grid 3 cột như Instagram.

**Cộng đồng — browse-first cho guest**:
- Feed kiểu Instagram: avatar + tên + thời gian tương đối + carousel ảnh vuốt được (tối đa 4 ảnh) + nút ♥ + caption + tag/hashtag.
- **Khách vãng lai (chưa login)** vào tab thấy ngay 10 quán mới nhất (`GUEST_CAP=10`), không bị chặn bởi auth form. Nút "Đăng nhập" nhỏ ở top-right header (dùng chung slot `.add-btn` với "+ Đăng quán" — chỉ hiện 1 trong 2 tuỳ trạng thái) → mở auth form; form có link "← Xem quán trước" để quay lại browse. Search box + "+ Đăng quán" chỉ hiện khi login.
- Lưới hồ sơ 3 cột (Quán của tôi + xem hồ sơ người khác) + header avatar/tên/**4 số liệu** (quán đã đăng/★ nhận được/follower/**đang follow** — xem "Follow" bên dưới).
- Đăng quán: tên, danh mục, giá, mô tả, vị trí (map picker), tối đa 4 ảnh (nén WebP client-side), tag tự do + hashtag riêng, 3 mức riêng tư (private/friends/public).
- **Sửa quán**: thêm/xem/xoá ảnh khi sửa (2026-09-12, `CommunityAddModal`) — grid ảnh hiện có + ô "thêm" (tối đa 4 tổng), tap ảnh mở full-size xem (`PhotoView`, tap ra ngoài để đóng, không zoom/swipe), xoá gọi `Community.deletePhoto()`. Ảnh mới lúc sửa dùng cú pháp PocketBase `photos+` (append — KHÔNG dùng `photos` thường vì sẽ xoá sạch ảnh cũ), xoá dùng `photos-`. Cả 2 tự set lại `thumbnail` nếu ảnh bìa bị xoá/vừa thêm ảnh đầu tiên.
- **Draft tự lưu form đăng quán** (2026-09-12, `CommunityAddModal`): mọi field text/select tự lưu `localStorage` (`community_add_draft`, debounce 400ms, TTL 7 ngày, có `userId` để máy dùng chung không lộ draft người khác). Ảnh lưu riêng ở **IndexedDB** (`nhopnhep_draft` DB — File object không JSON hoá được, base64 thì tràn quota localStorage). **CHỈ áp dụng bài MỚI** — sửa bài có sẵn không bao giờ tạo/đọc draft. Banner "Discard" cho phép xoá tay; đăng thành công tự xoá draft; đóng modal không đăng thì GIỮ draft.
- Follow 1 chiều kiểu Twitter (field `friends` trên `users`, không cần đối phương chấp nhận).
- **Mutual-follow UI kiểu TikTok** (2026-09-13) — hoàn toàn client-side, KHÔNG thêm field/collection mới: đọc thẳng field `friends` của đối phương (đọc được vì listRule/viewRule `users` mở cho user đã login) để biết họ có follow lại mình không. Cả 2 chiều đều true → nút "🤝 Bạn bè" (style `.mutual`); họ follow mình nhưng mình chưa follow lại → "Follow back" + tag "follows you"; còn lại → follow/unfollow bình thường.
- **Stat "Đang follow" riêng tư** (2026-09-13, `FollowingListModal`) — CHỈ hiện trên chính profile của mình (param `followingCount` cố tình không truyền khi render header của người khác), đọc qua `Community.myFriends()` — API này luôn nhắm vào `Community.currentUser.id`, không nhận userId ngoài nên không có đường lộ "user X đang follow ai" ra công khai. Khác với stat "Follower" (đã có từ 2026-09-11, server-side filter `friends.id?="userId"`, xem được của BẤT KỲ ai).
- Sửa/xoá quán của mình qua modal chi tiết (bấm vào quán → nếu là chủ thì hiện nút Sửa/Xoá thay vì tác giả+tim).
- **"Cùng 1 quán" — liên kết nhẹ giữa các bài trùng (2026-09-11)**: nhiều người đăng cùng 1 quán ngoài đời thật (vd nhiều người cùng đăng "WeGo Trích Sài") giờ có thể liên kết lại thay vì hiện thành nhiều bài rời rạc. Field `linked_to` (self-relation, `restaurants`) — người đăng TỰ xác nhận, KHÔNG BAO GIỜ tự động gán. Lúc điền tên+vị trí trong form đăng quán, tự so khớp (tên bỏ dấu/hoa-thường chứa nhau + trong 80m) với quán mình VỐN ĐÃ có quyền xem, hỏi xác nhận nếu tìm thấy. Hiển thị gộp chia 2 tầng: feed tính rẻ trên dữ liệu đã tải sẵn (không gọi thêm API), modal chi tiết gọi 1 truy vấn riêng lấy chính xác toàn bộ nhóm. Toàn bộ đều đi qua `Community.listRestaurants()` sẵn có nên KHÔNG mở đường rò rỉ riêng tư mới — chỉ gộp những gì người xem vốn đã thấy được. Xem `Community.findSimilarNearby()`/`getLinkedGroup()`/`resolveRootId()` trong `js/community.js`.
- **Feed tự cập nhật** (2026-09-12, `CommunityCtrl`) — **KHÔNG PHẢI PocketBase realtime/SSE**: đã thử SSE trước, nhưng Cloudflare Quick Tunnel "nuốt" stream body (200 OK, header đúng `text/event-stream`, nhưng 0 byte sau 8s) — xem comment trong `js/community.js` ~dòng 166-180. Giải pháp thay thế: poll nhẹ mỗi 20s (`LIVE_POLL_MS`) chỉ 1 record 2 field (`id,updated`) để tính "signature" thay đổi, CHỈ chạy khi đang mở tab Cộng đồng. Nếu user đang ở đầu list → tự vẽ lại; nếu đang cuộn xuống → hiện pill "N bài mới" thay vì giật nội dung dưới tay họ. **Lưu ý quan trọng**: mục 7 bên dưới có ghi 1 hạng mục "Dòng thời gian hoạt động thật" giả định dùng SSE — giả định đó ĐÃ SAI (SSE không chạy được qua Quick Tunnel), và tính năng đó (feed ưu tiên hoạt động người mình follow) VẪN CHƯA làm — cái vừa xong chỉ là refresh/thông báo bài mới, không phải xếp hạng theo follow.
- **Bookmark + Copy link** (2 nút trong CommunityDetailModal, phía trên Đóng/Google Maps): 🔖 Lưu (toggle vào `State.savedPosts` — localStorage per browser, không cần login) · 📋 Sao chép link (clipboard `nhopnhep.pages.dev/?q=<pb_id>` — deep-link handler trong `app.js:boot()` đọc `?q=` và auto-open CommunityDetailModal cho quán đó sau 400ms).
- Avatar emoji đồng bộ lên server (`avatar_emoji` field trên users, xem mục 4).

**Bảo mật — Cloudflare Turnstile chống tạo tài khoản ảo hàng loạt (2026-09-11)**:
- Widget Turnstile (`#communityTurnstile`, site key hardcode trong `index.html`) chỉ hiện ở form ĐĂNG KÝ (không phải đăng nhập). Token lấy qua `window.turnstile.getResponse(element)` — **phải truyền DOM element, không phải id string**, truyền string sẽ throw (đã fix 1 lần, xem commit `fe02059`). Reset token sau mỗi lần submit vì token dùng 1 lần.
- Xác thực THẬT nằm server-side ở `functions/api/register.js` — verify qua Cloudflare `siteverify`, check `action`, check `hostname` khớp allowlist. Client không thể bypass bằng cách tự chế token giả.
- **Cần `TURNSTILE_SECRET`** set trong Cloudflare Pages env var/secret (KHÔNG có trong code) — nếu thiếu, mọi lượt đăng ký fail-closed 500. Kiểm tra qua Cloudflare Dashboard → nhopnhep → Settings → Environment variables nếu nghi register bị lỗi hàng loạt.

**Analytics / observability (2026-09-10)**:
- Custom event tracking → PocketBase collection `analytics_events` (schema mục 4). 7 event lifecycle: `app_open` (boot) · `scan` (props: radius/cats/srcs/has_dish/min_rating) · `plan_built` (stops, replay flag) · `detail_open` (source: osm/gemini/community/mine + has_image/has_coords) · `add_quán` (cat, price, visibility, photo/tag/hashtag counts) · `login`/`register` · `follow`.
- Đi qua `/api/log` Cloudflare Function (same-origin) chứ KHÔNG post trực tiếp lên tunnel — verified: cross-origin sendBeacon với URL chứa "analytics_events" bị mọi ad blocker + tracking protection chặn silent (0 event thu được từ browser), same-origin thì immune.
- **`user_name` field** (2026-09-13, thêm vào `js/analytics.js`) — tên hiển thị (KHÔNG phải email) đi kèm `user_id` trong mọi event, để filter trong PB Admin bằng tên người thật thay vì phải tra ngược id trước. Chỉ là field gửi thêm từ client, không có gì enforce phía server.
- Slot cho **Cloudflare Web Analytics** đã sẵn trong `<head>` của index.html (comment). Chỉ cần vào `dash.cloudflare.com > Web Analytics > Add site > nhopnhep.pages.dev > copy beacon script` rồi uncomment + paste token. **Vẫn CHƯA gắn** (confirm lại 2026-09-14) — thấy mục 10.
- Session identity: crypto.randomUUID() lưu localStorage `analytics_session_id`, vĩnh viễn cho browser đó. Khi login, `user_id`+`user_name` join thêm trên top (không thay session_id). Đếm unique visitor = unique session_id; DAU = unique session_id có event trong ngày.

**Crash reporting + API call logging (2026-09-12, `functions/api/error-report.js` + `app.js`)**:
- Client: IIFE trong `app.js` bắt `window.onerror` + `unhandledrejection`, gửi `/api/error-report` qua sendBeacon (fallback fetch keepalive), cap **5 report/session** để tránh spam nếu 1 lỗi lặp lại liên tục. Payload có `ver` — **hardcode string `'v2526'` trong code, KHÔNG tự sync với `?v=NNNN` cache-buster** — nếu debug theo version phải nhớ bump tay chỗ này riêng, dễ quên.
- Server: luôn `console.error('[crash]', ...)` — xem qua **CF Dashboard → nhopnhep → Deployments → (deployment bất kỳ) → Functions tab → Real-time Logs**, filter `[crash]` cho lỗi JS, filter `[api]` cho log gọi API/latency của các function khác (overpass.js, log.js, register.js cũng có structured logging tương tự, filter `[api]`). Ghi thêm best-effort vào PocketBase collection `error_logs` (schema mục 4) — KHÔNG bắt buộc collection này tồn tại, function tự bỏ qua nếu lỗi.

**Song ngữ VI/EN**: toàn app, ~350 key (thêm ~21 key cho Group Session 2026-09-16), đổi ngôn ngữ tức thời không reload, chọn trong modal Tài khoản.

**PWA**: cài được vào màn hình chính, có manifest + icon SVG. **KHÔNG có offline/service worker** dù là PWA.

---

## 3.5. Phiên chọn quán theo nhóm ("Group Session") — 2026-09-16, ĐÃ SHIP

**Ý tưởng sản phẩm**: giải quyết "5 bạn bè không biết ăn ở đâu" — bài toán mà Google Maps/Foody hoàn toàn chưa có lời giải (họ là công cụ tìm kiếm 1-người, không có cơ chế quyết định NHÓM). Host chọn 1 nhóm quán ứng viên, chia sẻ 1 link, bạn bè vote KHÔNG CẦN tài khoản, host chốt random trong nhóm được vote nhiều nhất — cả nhóm thấy cùng 1 kết quả trong vài giây (poll 3s, không phải PocketBase realtime — xem lý do bên dưới). Đây được xác định là **USP chính** của app so với Google Maps sau 1 buổi bàn chiến lược cùng ngày (Google Maps = index quán ăn; Nhóp Nhép = công cụ NHÓM quyết định).

**Trạng thái**: commit `112bbbe` — đã ship, đã deploy production, migration backend đã áp dụng. **CHƯA test được happy-path đầy đủ bằng tài khoản thật** (Turnstile chặn Claude tự tạo tài khoản test qua browser automation — đây là bảo mật hoạt động ĐÚNG, không phải trở ngại cần gỡ). Người dùng cần tự test 1 lần theo hướng dẫn cuối mục này.

### Data model — 2 collection mới trên backend PocketBase

Xem `NhopNhep-community-server/pb_migrations/`:
- `1789530600_create_dining_sessions.js` — session: `host` (relation users), `title`, `candidates` (**JSON snapshot**, KHÔNG phải relation — vì quán từ OSM/Gemini không có id PocketBase ổn định để relation tới, chỉ quán cộng đồng mới có; mỗi candidate mang `cid` tự sinh theo vị trí `'c'+index`, chỉ cần unique TRONG session đó), `status` (open/closed), `winner_cid`, `expires_at` (app tự set now+2h lúc tạo — KHÔNG có TTL tự động phía PocketBase, hết hạn chỉ là field client tự kiểm tra để hiện banner, session vẫn tồn tại mãi trong DB trừ khi dọn tay).
- `1789530601_create_session_votes.js` — 1 record = 1 lượt vote (giống triết lý collection `votes` sẵn có: "tồn tại record = 1 phiếu", không có field `value`). `voter` (relation, cho user đăng nhập) HOẶC `guest_token` (text, cho khách — client tự sinh `crypto.randomUUID()` lưu `localStorage['nhopnhep_guest_token']`) — 2 field loại trừ nhau, ép ở `createRule`.
- `1789544700_tighten_session_votes_rules.js` (**migration vá bảo mật, viết SAU khi adversarial review tìm ra lỗ hổng — xem phần Review bên dưới**) — siết `listRule` + `deleteRule` của `session_votes`.

**Migration đã áp dụng bằng cách restart RIÊNG `pocketbase.exe`** (không đụng `cloudflared.exe`/tunnel) — cách này an toàn hơn hẳn chạy `Bat-TOAN-BO.ps1` đầy đủ (không rotate tunnel, không cần đồng bộ URL 4 file, downtime chỉ vài giây cho riêng PocketBase). Nhớ cách này cho lần cần áp migration tiếp theo — nhanh và ít rủi ro hơn.

### Adversarial review — BỊ CẮT NGANG, đọc kỹ phần này trước khi tin tưởng feature 100%

Chạy workflow 5 lens (pb-rule-tracing, correctness, security, race-conditions, backward-compat) + adversarial verify (3 skeptic/finding) trước khi ship — **nhưng session bị hit usage limit giữa chừng, chỉ 2/5 lens kịp hoàn thành** trước khi hàng loạt agent fail với lỗi "session limit". Nghĩa là **correctness, race-conditions, và backward-compat lens CHƯA TỪNG CHẠY THẬT** — chỉ có `pb-rule-tracing` (đã chạy đủ) và 1 lens khác trả về rỗng đã hoàn thành.

`pb-rule-tracing` tìm ra **3 vấn đề thật**, đã fix cả 3 trước khi commit:
1. **`session_votes.listRule` cũ = `""` (public vô điều kiện)** — bất kỳ ai KHÔNG có link mời cũng list được TOÀN BỘ vote của MỌI session, lộ cả `guest_token` (là "mật khẩu" duy nhất của khách) → có thể enumerate session + impersonate khách bất kỳ. **Fix**: `listRule` mới bắt buộc query param `?session=<id>` khớp field `session` của record (migration `1789544700`), `community.js` đã sửa gửi kèm param này ở mọi lệnh list (`myVotesInSession`, `myVoteInSession`, `sessionSignature`, `getSessionResults`). Đã verify qua curl: list không kèm `?session=` trả `items:[]` (không leak), có kèm thì hoạt động bình thường.
2. **`session_votes.deleteRule` cũ cho phép xoá vote của BẤT KỲ khách nào** (PocketBase delete rule không đọc được token của người gọi để so — chỉ check record có `guest_token != ''`, đúng với MỌI vote của khách bất kỳ). **Fix**: bắt buộc `?guest_token=<token của chính mình>` khớp field record (cùng migration `1789544700`), `castVote()`'s un-vote path đã sửa gửi kèm.
3. **`castVote()` phụ thuộc giả định "field vắng mặt = rỗng" của PocketBase** cho `createRule` — lens tự nhận không verify được chắc chắn 100%, khuyến nghị test sống. **Fix (loại bỏ hẳn rủi ro thay vì test)**: `castVote()` giờ LUÔN gửi tường minh cả `voter`+`guest_token` (rỗng cho cái không dùng) thay vì bỏ hẳn field không dùng.

**Vẫn CHƯA được review** (do bị cắt ngang) — nếu có thời gian, chạy lại workflow (script đã lưu, xem transcript `wf_f80d7463-7b4` trong thư mục session cũ, hoặc viết lại từ đầu) tập trung 3 lens còn thiếu:
- **correctness**: logic polling (`_pollTick`/`_scheduleNext`/`_startPolling` trong `SessionVoteModal`, `js/controllers.js`) — nghi vấn tự nêu trong prompt review (chưa verify): `_pollBusy` có thể stuck `true` nếu exception ném giữa chừng? interval có bị tạo trùng không?
- **race-conditions**: đây là tính năng ĐA NGƯỜI DÙNG ĐỒNG THỜI DUY NHẤT trong app (mọi tính năng khác đều single-user) — 2 người vote cùng lúc, host chốt đúng lúc có vote đang bay, tunnel rotate giữa lúc đang vote (rủi ro CÓ THẬT — xem mục 4, tunnel rotate mỗi 10-25 phút).
- **backward-compat**: `ResultsCtrl._updatePlanBtn()` bị sửa (thêm toggle nút mới) — tôi tự tin logic cũ không đổi (đã đọc lại tay), nhưng chưa có lens riêng xác nhận độc lập.

### Files đã đổi

| File | Nội dung |
|---|---|
| `js/community.js` | `createSession`, `getSession`, `castVote`, `sessionSignature`, `getSessionResults`, `closeSession`, `myVoteInSession`/`myVotesInSession`, `getGuestToken` |
| `js/controllers.js` | `SessionCreateModal` (host chọn quán từ `State.selected` có sẵn ở màn Kết quả) + `SessionVoteModal` (poll 3s, backoff 9s sau 3 lỗi liên tiếp, optimistic UI vote/unvote + rollback, reconnect banner, host-only "Chốt & random"); `ResultsCtrl._updatePlanBtn()` sửa thêm toggle nút mới |
| `js/app.js` | Init 2 controller mới + deep-link `?join=<session_id>` (y hệt pattern `?q=`/`?ref=` có sẵn) |
| `index.html` | Nút "👥 Tạo phiên chọn quán" (màn Kết quả) + 2 modal mới (`sessionCreateOverlay`, `sessionVoteOverlay`) |
| `css/styles.css` | ~15 class mới, prefix `.session-*`, style nhất quán "sticker" 2px border + box-shadow đã dùng toàn app |
| `js/i18n.js` | 21 key mới (`session.*`, `toast.session*`), vi+en |
| `NhopNhep-community-server/pb_migrations/` | 3 file migration (2 tạo collection + 1 vá bảo mật) |

### Việc còn lại — nếu tiếp tục

1. **Bắt buộc**: người dùng thật tự test happy-path 1 lần (đăng nhập → chọn 2+ quán → tạo phiên → mở link ở tab khác vote như khách → chốt → xem kết quả) — Claude không tự làm được vì Turnstile chặn tạo tài khoản.
2. Chạy lại review cho 3 lens chưa kịp chạy (correctness/race-conditions/backward-compat) nếu muốn chắc chắn hơn trước khi quảng bá rộng.
3. v2 đã bàn nhưng CHƯA làm (xem thêm mục 5): push notification khi có vote mới/khi chốt xong, lịch sử phiên đã qua, proxy session/vote traffic qua Cloudflare Pages Function để sống sót qua tunnel rotate giữa chừng (thay vì chỉ hiện banner "mất kết nối").

---

## 3.6. Tìm địa chỉ + định vị — nâng cấp 2026-09-15/16

**Vấn đề gốc**: geocoder cũ (chỉ Photon/Komoot) fuzzy-match sai cho địa chỉ VN có số nhà (vd "10 Phan Chu Trinh" ra "Phan Huy Chú"), và app luôn mặc định vị trí Hoàn Kiếm-Hà Nội cho tới khi user tự cấp GPS.

**Đã làm**:
- **`functions/api/geo.js`** (mới) — dùng `request.cf.{latitude,longitude,city}` sẵn có của Cloudflare (miễn phí, không cần key) làm default vị trí ban đầu, chính xác cấp thành phố. Boot flow: cache localStorage (GPS/pick lần trước, TTL 7 ngày) → HN fallback tạm → CF geo async override nếu vẫn còn fallback. Nhãn tự thêm "(ước tính)" + gợi ý bật GPS khi dùng CF geo (vì IP geo không phân biệt được quận trong cùng thành phố — feedback thật từ user Threads).
- **`functions/api/geocode.js`** (mới) — proxy Nominatim (OSM), race song song với Photon trong `js/geocoder.js`, rerank ưu tiên kết quả có housenumber khớp. Thêm `_parseAddress()` parse địa chỉ VN (số nhà/phố/quận/thành phố + viết tắt HN/HK/Q1...).
- Dropdown ẩn POI khi query có số nhà (tránh nhầm quán ăn cùng số nhà với toà nhà thật); giữ nguyên text người dùng gõ khi pick (không ghi đè bằng tên rút gọn).
- iOS: `autocorrect/autocapitalize=off`, skip IME composition event (gõ Telex/VNI không bị "kẹt" giữa chừng).

**Bug nghiêm trọng phát hiện + fix cùng đợt**: `HomeCtrl.scan()` có race condition — khi Gemini chưa cấu hình (`useGemini=false`), `Promise.resolve([])` của nhánh Gemini resolve NGAY (microtask) trước khi `POI.fetch()` (Overpass) kịp trả về, khiến điều kiện race "đủ số nguồn trả lời" trip sớm → **mọi user không có Gemini key thấy "Không tìm thấy quán" ở khắp nơi, kể cả khu đông đúc**. Đã fix (commit `3664a6e`) — chỉ chờ nhánh nào thực sự bật.

---

## 4. Hạ tầng vận hành — quan trọng, đọc kỹ trước khi đổi gì

Thư mục: `G:\0. Home_Vinh\Projects\NhopNhep-community-server\` (nằm ngoài git — đây KHÔNG phải repo riêng, chỉ là file trên máy, đang nằm lẫn trong 1 workspace git của dự án khác (`bop_chop`) nên đừng git-add nhầm).

- `pocketbase.exe serve --http=127.0.0.1:8090` + `cloudflared.exe tunnel --url http://127.0.0.1:8090` (Quick Tunnel — ẩn danh, URL dạng `https://xxx.trycloudflare.com`, **đổi mỗi lần restart**). Cloudflare tự ghi rõ loại tunnel này KHÔNG dành cho production — xem mục "Tunnel rớt liên tục" ngay dưới.
- Máy: i5-12400F 6 nhân/12 luồng, 32GB RAM — dư sức, KHÔNG phải điểm nghẽn. Điểm nghẽn thật là **băng thông mạng** (đo thật: ~22 Mbps down / ~18 Mbps up) và **độ ổn định kết nối** (đang qua WiFi, không phải dây mạng).
- **2 Scheduled Task đã bật** (Task Scheduler Windows, tên bắt đầu `NhopNhep-`):
  - `NhopNhep-Backup` — robocopy mirror `pb_data` → `F:\Backup\NhopNhep-pb_data` mỗi 6 tiếng.
  - `NhopNhep-Watchdog` — chạy `Bat-TOAN-BO-Auto.ps1` mỗi **2 phút** (giảm từ 5 phút ngày 2026-09-10, xem mục "Tunnel rớt liên tục"), tự kiểm tra PocketBase + tunnel còn sống không; nếu sập thì tự khởi động lại, lấy URL tunnel mới, tự sửa `js/community.js` + `functions/api/log.js`, tự bump cache version, tự git commit/push, tự `wrangler pages deploy`. Đã test thật bằng cách kill process giả lập sập — tự phục hồi hoàn toàn trong ~2 phút.
  - Script gốc `Bat-TOAN-BO.ps1` (có `Read-Host` chờ Enter) vẫn còn, dùng khi bạn tự double-click thủ công từ Desktop — đừng schedule cái này (sẽ treo vô hạn vì không ai bấm Enter).
  - **An toàn với code đang dở** (fix 2026-09-10): cả 2 script trước đây `git add -A` rồi `wrangler pages deploy .` thẳng từ working directory — nghĩa là bất kỳ edit nào đang dở dang (kể cả của 1 phiên Claude Code khác đang chạy song song trên máy) đều có thể bị auto-commit + auto-deploy lên production NGOÀI Ý MUỐN, xảy ra thật ít nhất 1 lần (harmless vì code lúc đó tình cờ đã xong, nhưng không đảm bảo luôn vậy). Đã fix: `git add` giờ chỉ add đúng 3 file script tự sửa (`js/community.js`, `functions/api/log.js`, `index.html`); deploy giờ chạy từ 1 bản `git archive HEAD` sạch (export riêng ra thư mục temp) thay vì thư mục làm việc sống — nên watchdog CHỈ BAO GIỜ đưa lên production đúng những gì đã commit, không bao giờ đụng vào file đang dở của ai khác.
- **Migration**: `1725700007_add_user_avatar.js` (field `avatar_emoji` trên `users`) + `1725700008_add_restaurant_linked_to.js` (field `linked_to`, self-relation trên `restaurants` — xem mục 3 "Cùng 1 quán"). Cả 2 đã áp dụng live bằng cách restart PocketBase (không cần đụng tunnel).
- **Collection `analytics_events`** (tạo qua Admin UI 2026-09-10, KHÔNG có migration file — nếu setup lại PocketBase ở máy khác phải tạo lại thủ công qua Admin UI):
  - Fields: `event` (text, required, indexed, Presentable, max 40) · `session_id` (text, required, indexed, max 40) · `user_id` (relation → users, nullable, single, indexed) · `user_name` (text — thêm 2026-09-13, tên hiển thị đi kèm để filter khỏi tra ngược id) · `props` (json) · `is_guest` (bool) · `ua` (text, max 200) · `referrer` (text, max 200) · `created` (autodate on Create) · `updated` (autodate on Create/Update).
  - Indexes: `idx_ae_event`, `idx_ae_session`, `idx_ae_user`, `idx_ae_created`.
  - **API rules quan trọng**: List/View/Update/Delete = superusers only. **Create = EMPTY string** (không phải null, không phải "superusers only") — để anonymous browser POST được. Nếu Create = superusers-only, browser sẽ 403 và 0 event thu được. Xem debug trip 2026-09-10 nếu quên rule này lần nữa.
- **Collection `error_logs`** (2026-09-12, cho crash reporter — mục 3, **KHÔNG bắt buộc phải tồn tại**, function `error-report.js` tự bỏ qua PocketBase nếu thiếu, vẫn log ra `[crash]` trên CF Real-time Logs):
  - Fields (tất cả optional): `kind` (text — `js_error`/`promise_rejection`) · `msg` (text) · `src` (text) · `line` (number) · `col` (number) · `ver` (text) · `href` (text) · `ip` (text) · `country` (text) · `colo` (text) · `t` (text).
- **Turnstile (2026-09-11)**: site key hardcode `index.html` (public, không nhạy cảm). **`TURNSTILE_SECRET`** phải set trong **Cloudflare Pages → nhopnhep → Settings → Environment variables** (dashboard, KHÔNG có trong code/git) — nếu quên set sau khi tạo project mới hoặc đổi tài khoản Cloudflare, mọi lượt đăng ký sẽ fail-closed 500.
- **Superuser**: email/password nằm trong `README.md` của thư mục community-server (đã đổi 1 lần sau khi phát hiện lộ qua tunnel công khai — xem CHANGELOG/README ở đó, KHÔNG chép lại ở đây).
- Dữ liệu thật hiện tại: rất ít (3 quán cộng đồng, vài chục KB) — quy mô còn rất sớm.

**Deploy — PHÁT HIỆN LẠI 2026-09-14: git-connected auto-deploy đang bật, không phải Direct Upload như tài liệu cũ ghi**:
- Xác nhận bằng `npx wrangler pages deployment list --project-name=nhopnhep`: push commit `02f421c` lên `origin/master` → deployment MỚI xuất hiện "just now" khớp đúng hash, KHÔNG cần chạy `wrangler pages deploy` thủ công.
- Chưa rõ chính xác từ bao giờ (nhìn list deployment thấy ít nhất từ commit `43c935f`, 2026-09-11, đã auto-deploy — nghĩa là suốt 3 ngày qua mọi lần tôi (phiên trước) chạy `wrangler pages deploy` thủ công đều chỉ tạo thêm 1 deployment TRÙNG LẶP không cần thiết, không sai nhưng lãng phí).
- **Từ giờ chỉ cần `git push origin master` là đủ** — bỏ hẳn bước `wrangler pages deploy` khỏi quy trình chuẩn (mục 6 đã sửa).

**Watchdog bug — ĐÃ FIX phần 2/3, còn 1/3 chưa root-cause** — phát hiện 2026-09-10 19:05, fix phần coordination 2026-09-11:
- Sự cố gốc: `NhopNhep-Watchdog` phát hiện tunnel `dice-impressed-historical-internet` chết, spawn tunnel mới `decreased-subject-multimedia-wolf` thành công (log "URL tunnel moi: ..." xuất hiện), NHƯNG dừng ngang không tiếp tục bump cache version + git commit/push + wrangler deploy như các lần trước. Phải fix tay lần đó.
- **Đã fix**: cả `Bat-TOAN-BO-Auto.ps1` (watchdog) và `Bat-TOAN-BO.ps1` (script thủ công) giờ ĐỀU cập nhật `functions/api/log.js` PB_URL song song với `js/community.js` DEFAULT_URL mỗi khi tunnel rotate — không còn phải nhớ sửa tay 2 chỗ nữa. Đã test script watchdog chạy sạch (no-op khi khoẻ, không lỗi).
- **CHƯA root-cause**: lý do script dừng ngang giữa chừng lần đó (không tiếp tục bump version/commit/deploy) vẫn chưa rõ — nghi ngờ ban đầu (wrangler cần interactive auth, hoặc script không biết log.js) chỉ đúng 1 phần (thiếu log.js đã fix), phần "dừng ngang" gốc có thể là nguyên nhân khác (transient network lúc đó, hoặc git/wrangler timeout) chưa tái hiện lại được để xác nhận. Nếu thấy watchdog log dừng giữa chừng lần nữa (có dòng "URL tunnel moi" nhưng không có "DA TU PHUC HOI XONG"), xem `last-deploy.log`/`quicktunnel.log` lúc đó để tìm nguyên nhân thật.

**Tunnel rớt liên tục — chẩn đoán 2026-09-10 tối, ĐANG THEO DÕI (chưa xác nhận hết hẳn)**:
- Người dùng báo site thỉnh thoảng lỗi "Không tải được / server có đang chạy không" dù PocketBase rõ ràng đang bật.
- Đọc `auto-watchdog.log` xác nhận: `PocketBase ok=True, Tunnel ok=False` lặp lại mỗi 10-25 phút (21:00, 21:10, 21:35 tối 2026-09-10) — PocketBase không hề chết, chỉ riêng tunnel Quick Tunnel rớt liên tục. Mỗi lần rớt, site sẽ lỗi trong khoảng thời gian từ lúc rớt tới lúc watchdog phát hiện + cấp URL mới + tunnel mới sẵn sàng (log có nhiều dòng "tunnel chưa phản hồi kịp sau 80s").
- **Nghi ngờ nguyên nhân chính**: Wi-Fi power-saving. Máy nối tunnel qua Wi-Fi (`ICMP proxy ... in zone Wi-Fi` trong log cloudflared); kiểm tra registry adapter Wi-Fi (`PnPCapabilities=16`) xác nhận Windows đang ĐƯỢC PHÉP tự tắt adapter để tiết kiệm điện — nguyên nhân kinh điển gây rớt kết nối dài-hạn (như cloudflared QUIC) đúng chu kỳ vài-chục-phút. Đây là thay đổi Windows system setting nên Claude không tự sửa được (nằm ngoài phạm vi cho phép) — **đã yêu cầu người dùng tự chạy** `Disable-NetAdapterPowerManagement -Name "Wi-Fi"` (PowerShell Admin) hoặc bỏ tick qua Device Manager > Wi-Fi adapter > tab Power Management.
- **Đã làm ngay** (giảm nhẹ, không sửa gốc): rút ngắn chu kỳ `NhopNhep-Watchdog` 5 phút → 2 phút, giảm ~60% thời gian site lỗi mỗi lần tunnel rớt.
- **Fix triệt để, CHƯA làm** (người dùng chọn chờ xem 2 fix trên có đủ không trước): chuyển từ Quick Tunnel (ẩn danh, URL đổi mỗi lần restart, Cloudflare ghi rõ không dành cho production) sang **Named Tunnel** (`cloudflared tunnel create` + `cloudflared tunnel route dns`, cần 1 domain/subdomain gắn vào Cloudflare account) — URL cố định vĩnh viễn, ổn định hơn hẳn, xoá luôn được toàn bộ cơ chế watchdog-dò-URL-mới hiện tại (không còn URL nào để rotate nữa). Account Cloudflare hiện tại (`bachvinhtran@gmail.com`, xem `npx wrangler whoami`) CHƯA có domain/zone nào ngoài các `*.pages.dev` mặc định — cần domain riêng (đã có sẵn hoặc mua mới) trước khi làm bước này.
- Nếu sau vài ngày tắt Wi-Fi power-saving mà vẫn thấy watchdog log ghi "Tunnel ok=False" lặp lại — quay lại làm Named Tunnel, đừng thử thêm workaround khác cho Quick Tunnel.

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
