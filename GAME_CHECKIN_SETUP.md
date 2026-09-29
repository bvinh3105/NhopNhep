# Thêm tài khoản "Bà Thảo" và mở cổng check-in từ game Cơm Tấm Bà Thảo

Tài liệu bàn giao cho phiên Claude phụ trách Nhóp Nhép (frontend + PocketBase). Viết ngày 2026-09-29.

## Checklist nhanh (2026-09-29) — code 2 bên đã xong, chỉ còn việc thủ công này

Code "chụp xong → gửi lên Nhóp Nhép" đã đầy đủ ở cả game (`nhopnhep.js`, đã push live)
và Nhóp Nhép (nhánh `game-checkin`, đưa lên master 2026-09-29) — xem chi tiết từng bước ở §1-4 dưới.
Chỉ còn các việc **chủ app tự làm** (cần Admin UI / Cloudflare / secrets):

- [x] 1. User "Bà Thảo" — id **`p1b99ipcit1kskm`** (chủ app tạo, 2026-09-29)
- [x] 2. Quán "Cơm Tấm Bà Thảo" — id **`i99wc0ypelhuxqj`**, `visibility=public`, `created_by` = Bà Thảo (đã kiểm tra qua API)
- [x] 3. Turnstile: đã thêm `bvinh3105.github.io` vào widget "NhopNhep Registration Guard" — site key giữ nguyên `0x4AAAAAAEvamwVLTYTX0-jM`, không cần `GAME_TURNSTILE_SECRET`
- [x] 4. Env Production: `NN_GAME_BOT_USER=p1b99ipcit1kskm`, `NN_GAME_QUAN=i99wc0ypelhuxqj` (Text); `PB_ADMIN_EMAIL`/`PB_ADMIN_PASSWORD` (Secret) — 2 biến này **trước đó không có trên Production** (nên `notify-follow.js` cũng chưa từng chạy được), chủ app đã tạo superuser riêng cho Function và thêm 2026-09-29. Lưu ý: biến mới trên Pages chỉ có hiệu lực từ **lần deploy kế tiếp**.
- [x] 5. Server thật: đã chép 2 file + restart riêng `pocketbase.exe` (2026-09-29). Server thật mới có tới `1790000007` nên **0400 lên trước 0110** — xem cảnh báo ở mục 0110 trong `STAGED_CHANGES.md`.
- [x] 6. Watchdog: đã thêm `game-checkin.js` vào cả 2 script (chỉ log cảnh báo cho tới khi nhánh merge)

**Code đã điền:** `QUAN_ID` trong `js/ctbt.js`; `quanId` + `refCode` + `turnstileSiteKey` trong `public/js/nhopnhep.js` (chạy thử local: nút "Đăng lên Nhóp Nhép" mở, widget Turnstile hiện đúng). Tăng `?v=` cho `styles.css`/`i18n.js`/`ctbt.js`/`controllers.js`/`app.js` lên 2737 (nhánh gốc sửa 4 file này mà chưa tăng).

**Còn lại (hỏi trước từng bước):**
1. ~~Đưa nhánh lên master~~ — **đã làm 2026-09-29**: fast-forward `master` **trong thư mục `NhopNhep`** (không đổi nhánh) rồi `git push origin master`. Không push thẳng `game-checkin:master` từ worktree — watchdog push từ `NhopNhep` bằng `git push origin master` mà không pull trước, nên nếu master ở đó tụt sau origin thì lần đổi tunnel kế tiếp push sẽ bị từ chối, site trỏ tunnel chết.
2. Commit + push repo game (deploy công khai ngay).
3. Bật `NN_GAME_CHECKIN=on` → **Retry deployment** (Deployments → bản mới nhất), vì Pages không tự redeploy khi đổi biến → curl kiểm tra §6.

## 0. Bối cảnh (đọc trước)

- Game **Cơm Tấm Bà Thảo** (https://bvinh3105.github.io/com-tam-ba-thao/, repo `bvinh3105/com-tam-ba-thao`) cho người chơi "chụp" đĩa cơm đẹp nhất cuối ngày rồi đăng lên Nhóp Nhép.
- Chủ app đã chốt các quyết định sau (2026-09-28):
  - Game **tự đăng hộ** dưới **một tài khoản chung "Bà Thảo"**, vào **một quán "Cơm Tấm Bà Thảo"**. Người chơi không cần tài khoản Nhóp Nhép.
  - Chấp nhận ảnh vẽ từ game (không phải ảnh camera). Các bài này có nhãn 🎮 trong app.
  - Check-in từ game **xem công khai** được ở trang quán. Check-in thật vẫn theo luật "chỉ bạn bè" (migration `1790000110`).
  - Lối vào game từ Nhóp Nhép có 4 chỗ: nhãn 🎮 trên check-in, nút "Chơi thử" ở trang quán, banner ở Cộng đồng › Quán ăn, và quà +20 uy tín trong game cho người tới qua `?from=nhopnhep`.
- **Đã có sẵn, chưa triển khai:**
  - Frontend + Function: nhánh **`game-checkin`**, commit `6027d93`, worktree `G:\0. Home_Vinh\Projects\NhopNhep-game`. Nhánh tách từ `master` b6a08f2, **chưa push, chưa merge**.
  - Server: 2 file đã chép vào `G:\0. Home_Vinh\Projects\NhopNhep-server-staging\`:
    - `pb_migrations/1790000400_checkins_game_source.js`
    - `pb_hooks/nn_game_checkins.pb.js`
  - `STAGED_CHANGES.md` **chưa có mục** cho 2 file này. Nếu chủ app đồng ý, thêm mục theo mẫu các mục cũ (nội dung lấy từ mục 5 bên dưới).
  - Lưu ý: test PB :8099 dùng thư mục `pb_migrations` staging, nên lần khởi động lại tới sẽ tự áp `1790000400`. Thay đổi này chỉ thêm, không xoá gì.
- **Nguyên tắc (theo memory của chủ app):**
  - Áp lên server thật, merge master, push: **phải hỏi chủ app trước**.
  - **Không tự xử lý bí mật.** Mật khẩu, secret Turnstile và `PB_ADMIN_*` do chủ app tự đặt.
  - Không đọc hay chép `TEST_CREDENTIALS.local.txt`.
  - Không `git add` gì trong `G:\0. Home_Vinh` (repo bop_chop).
  - Watchdog tự commit lên nhánh đang checkout ở thư mục `NhopNhep` rồi push `master`. Vì vậy **đừng đổi nhánh trong thư mục `NhopNhep`**, hãy làm trong worktree `NhopNhep-game`.

## 1. Những gì nhánh `game-checkin` thêm

| File | Việc |
|---|---|
| `functions/api/game-checkin.js` | Cổng `POST /api/game-checkin` (multipart). Đăng nhập PB bằng superuser (`PB_ADMIN_EMAIL`/`PB_ADMIN_PASSWORD`, dùng chung với `notify-follow.js` — thực tế chưa từng được đặt trên Production cho tới 2026-09-29) rồi tạo `checkins` với `user = NN_GAME_BOT_USER`, `restaurant = NN_GAME_QUAN`, `source = 'game'`, `is_shared = true`. |
| `js/ctbt.js` | Nhãn 🎮 trong viewer (`#ciViewerGame`), nút Chơi thử + dải ảnh ở trang quán (chỉ hiện khi `CtbtGame.QUAN_ID` khớp), banner `#ctbtBanner`. |
| `js/controllers.js` | 4 dòng gọi `CtbtGame`: `_renderPost`, `_renderActions` (ẩn "Đi tới" với bài game), `CommunityDetailModal.open` (HTML + wire). |
| `js/app.js`, `index.html`, `js/i18n.js`, `css/styles.css` | `CtbtGame.init()`, markup badge/banner, key `ctbt.*` vi/en, CSS. |

**Cổng chống lạm dụng** (người chơi ẩn danh nên cổng tự lo):
- Tắt mặc định: chỉ chạy khi `NN_GAME_CHECKIN = 'on'`.
- Chỉ nhận Origin `https://bvinh3105.github.io` (thêm localhost khi dev).
- Turnstile bắt buộc: `action = 'game_checkin'`, hostname `bvinh3105.github.io`.
- **Không nhận chữ tự do.** Note do server dựng từ 3 câu mẫu + số liệu đã kiểm tra (`weekday`, `served`, `perfect`, `net`, `caption` 0–2, `who` thuộc 6 khách trong game).
- Ảnh WebP/JPEG đúng **1080×1440**, tối đa 400KB. Kích thước đọc từ header file, không tin Content-Type.
- Giới hạn: **3 bài/IP/24h** (đếm trên PB qua trường ẩn `game_ip`) và **trần toàn hệ thống** `NN_GAME_DAILY` (mặc định 100/24h). Thêm lớp chặn dồn dập trong isolate: 5 lần/10 phút.
- Trả về `{ ok, id, url: "https://nhopnhep.pages.dev/?checkin=<id>" }`.

## 2. Tạo user "Bà Thảo" (chủ app làm trên PB thật, Admin UI)

Admin UI → collection **`users`** → New record:

| Trường | Giá trị |
|---|---|
| `email` | Email chủ app kiểm soát được, ví dụ bí danh `+bathao` của hộp thư chủ app. Không dùng email người khác. |
| `password` / `passwordConfirm` | Chuỗi ngẫu nhiên dài (≥ 32 ký tự). **Không cần lưu lại**: không ai đăng nhập tài khoản này, Function đăng bằng superuser. |
| `name` | `Bà Thảo` |
| `verified` | ✅ |
| `emailVisibility` | ❌ |
| `avatar_emoji` | `🍚` |
| `friends`, `invited_by` | để trống |

- Tạo bằng superuser nên hook `nn_register_guard.pb.js` (nếu đã bật) không chặn.
- Ghi lại **id** (15 ký tự `[a-z0-9]`). Id **không phải bí mật**, dùng cho `NN_GAME_BOT_USER`.
- Tuỳ chọn: id này cũng làm được mã mời `?ref=<id>`. Điền vào `NHOPNHEP_CFG.refCode` trong game để đếm người đăng ký từ game qua `invited_by`.

## 3. Tạo quán "Cơm Tấm Bà Thảo"

Admin UI → collection **`restaurants`** → New record:

| Trường | Giá trị |
|---|---|
| `name` | `Cơm Tấm Bà Thảo` |
| `category` | `via_he` |
| `price_range` | `binh_dan` |
| `visibility` | `public` |
| `created_by` | id user Bà Thảo ở bước 2 |
| `description` | `🎮 Quán trong game Cơm Tấm Bà Thảo — đứng quầy cơm tấm Sài Gòn, nướng sườn, thối tiền. Chơi: https://bvinh3105.github.io/com-tam-ba-thao/` |
| `address` | `Quán trong game (không có địa chỉ thật)` |
| `location` | để trống / 0,0. Nút Google Maps tự tắt. |
| `photos` | tuỳ chọn: ảnh check-in đẹp từ game |

- Ghi lại **id quán**. Id này dùng cho `NN_GAME_QUAN`, `CtbtGame.QUAN_ID` và `NHOPNHEP_CFG.quanId`.
- Link mở quán: `https://nhopnhep.pages.dev/?q=<id quán>`.

## 4. Thứ tự triển khai (hỏi chủ app trước mỗi bước đụng server thật hoặc push)

1. **Bước 2 + 3** ở trên (tạo user và quán).
2. **Server PB thật** (`NhopNhep-community-server`):
   - Chép `1790000400_checkins_game_source.js` vào `pb_migrations`, chép `nn_game_checkins.pb.js` vào `pb_hooks`.
   - Khởi động lại `pocketbase.exe` (Windows không tự reload hook).
   - Migration tự áp khi khởi động. Kiểm tra trong Admin UI → `checkins`: có trường `source` và `game_ip` (hidden); list/view rule kết thúc bằng `|| (source = 'game' && is_shared = true)`.
3. **Turnstile** (Cloudflare dashboard, chủ app làm):
   - Thêm hostname `bvinh3105.github.io` vào widget đang dùng (site key `0x4AAAAAAEvamwVLTYTX0-jM`, key public), **hoặc** tạo widget riêng cho game.
   - Nếu tạo widget riêng: đặt secret vào env `GAME_TURNSTILE_SECRET`. Nếu dùng chung: Function tự lấy `TURNSTILE_SECRET`.
4. **Env Cloudflare Pages (Production)**, chủ app đặt:
   - `NN_GAME_BOT_USER=<id user>`
   - `NN_GAME_QUAN=<id quán>`
   - tuỳ chọn `NN_GAME_DAILY` (mặc định 100)
   - kiểm tra `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` còn khớp một superuser PB thật
   - **Chưa** đặt `NN_GAME_CHECKIN`.
5. **Watchdog tunnel** (file vận hành, hỏi trước khi sửa): thêm `"functions\api\game-checkin.js"` vào mảng `$pagesFunctionsWithPbUrl` trong **cả** `NhopNhep-community-server\Bat-TOAN-BO-Auto.ps1` và `Bat-TOAN-BO.ps1`.
   - Nếu thiếu, `PB_URL` trong Function sẽ trỏ vào tunnel chết (đúng lỗi từng gặp với gemini-quota/notify-follow).
   - Function viết `const PB_URL = '...trycloudflare.com';` dùng nháy đơn, khớp regex của watchdog.
6. **Frontend:**
   - Trên nhánh `game-checkin`, điền `QUAN_ID: '<id quán>'` trong `js/ctbt.js`.
   - Kiểm tra `PB_URL` trong `functions/api/game-checkin.js` trùng URL tunnel hiện tại (so với `js/community.js` trên master).
   - Rebase/merge lên master mới nhất rồi push (hỏi trước).
   - Xung đột có thể gặp với nhánh `guest-60-40`: đã cố chèn ở chỗ ít đụng. Banner nằm trong `#communityFoodPane`, không nằm ở pane Check-in.
7. **Mở cổng:** đặt `NN_GAME_CHECKIN=on` rồi redeploy.
8. **Game** (repo `com-tam-ba-thao`, file `public/js/nhopnhep.js`, đầu file `NHOPNHEP_CFG`): điền `quanId`, `turnstileSiteKey` (site key public của widget đã có hostname github.io), tuỳ chọn `refCode`, rồi commit và push. Khi còn thiếu `quanId`/`turnstileSiteKey`, nút đăng trong game hiện "Sắp mở".

**Tắt khẩn cấp:** bỏ `NN_GAME_CHECKIN` → Function trả 503, game báo "chưa đăng được", ảnh vẫn lưu/chia sẻ được.

## 5. Chi tiết server (để ghi vào STAGED_CHANGES.md nếu chủ app đồng ý)

**`1790000400_checkins_game_source.js`**
- Thêm `checkins.source`: text, max 20; `''` là check-in thật, `'game'` là bài từ game.
- Thêm `checkins.game_ip`: text, max 64, **hidden**. Giá trị là sha256 rút gọn của IP (IPv6 gộp /64). Chỉ superuser đọc/lọc được.
- Thêm index `(source, created)`.
- **list/view:** đọc rule hiện có lúc áp rồi nối thêm `|| (source = 'game' && is_shared = true)`.
  - Số migration lớn hơn `0110` nên luôn chạy sau `0110`.
  - Nếu sau này có ai áp lại `0110` (vốn gán rule tuyệt đối), nhánh game sẽ mất và phải chạy lại `0400`.
- **create/update:** nối thêm `@request.body.source:isset = false && @request.body.game_ip:isset = false`.
  - Nếu không chặn, thành viên có thể tự gắn `source='game'` để biến bài riêng tư thành công khai dưới nhãn 🎮.
  - Superuser (Function) không bị rule chặn.
- `down()` gỡ đúng phần nối thêm, xoá 2 trường và index.

**`nn_game_checkins.pb.js`**
- Hook `onRecordAfterCreateSuccess` trên `checkin_reports`: chỉ cần **1 báo cáo** là check-in `source='game'` bị đặt `is_shared=false`, biến khỏi chỗ công khai. Bản ghi vẫn giữ để chủ app xem lại trong Admin UI và bật lại nếu bài không sao.
- Báo cáo check-in thật không bị ảnh hưởng.

**Đã test 2026-09-28: 52/52**
- Môi trường: PB 0.40.3 tạm trên 127.0.0.1:8097, DB mới dựng từ **toàn bộ** migration staging (có `0110`), superuser tạm tự tạo. Không đụng :8099 và :8090.
- Rule:
  - thành viên không tạo/PATCH được `source` (JSON và multipart, kể cả gửi rỗng);
  - `game_ip` thành viên gửi lên bị bỏ qua;
  - check-in thật vẫn chỉ bạn bè xem (khách và người không phải bạn nhận 404).
- Function:
  - origin lạ 403; công tắc tắt 503 (có CORS); thiếu secret Turnstile 500;
  - thiếu hoặc sai trường 400; ảnh sai kích thước, SVG giả WebP, >400KB hoặc thiếu ảnh 400;
  - Turnstile thiếu, sai action, sai hostname hoặc `success=false` 403;
  - ảnh WebP và JPEG thật từ game 1080×1440 được nhận;
  - khách ẩn danh xem được bài (kèm `expand=user`); note do server dựng; rating đúng công thức sao của game; thumb được phục vụ;
  - khách lọc theo `game_ip` 400;
  - giới hạn theo IP (IPv4 và IPv6 /64) và trần toàn hệ thống trả 429;
  - bị báo cáo 1 lần là ẩn;
  - OPTIONS chỉ trả CORS cho origin của game.
- `migrate down 1` trả rule về đúng chuỗi của `0110`.
- End-to-end: trang game trong Chrome headless tải widget Turnstile thật (site key test của Cloudflare) → gửi sang Function → 200.
- App (bản worktree trỏ vào :8097): nhãn 🎮 hiện, "Đi tới" ẩn với bài game, trang quán có dải ảnh mở được viewer, banner hiện.
- Harness nằm trong scratchpad của phiên trước (có thể đã bị dọn): `test_game.mjs`, `fn_server.mjs`. Nếu cần test lại, dựng lại theo danh sách trên.

## 6. Kiểm tra nhanh trên production (không tạo dữ liệu)

```bash
curl -s -X POST https://nhopnhep.pages.dev/api/game-checkin -H "Origin: https://bvinh3105.github.io" -F weekday=x
```

- Cổng đang tắt: `503`, message "tạm đóng cổng".
- Đã bật: `400` "Số liệu check-in không hợp lệ" (hợp lệ phải có ảnh + Turnstile).
- Log Cloudflare real-time lọc `"ep":"game-checkin"`, các `note` có thể gặp: `off`, `origin`, `fields`, `photo_kind`, `turnstile_fail…`, `ip_daily`, `global_daily`, `pb_create_<status>`, `created`.

## 7. Việc còn để ngỏ (hỏi chủ app)

- ~~Ghi mục `1790000400` + hook vào `STAGED_CHANGES.md`~~ — **đã ghi 2026-09-29** (mục cuối file, dùng đúng nội dung mục 5 ở trên, đối chiếu lại với code thật của 2 file trước khi viết).
- Có muốn dải "check-in gần đây" ở trang quán cho **mọi** quán, không chỉ quán Bà Thảo? Hiện `Community.getCheckinsForRestaurant` chưa quán nào dùng.
- Bubble "Bà Thảo" ở tab Check-in hôm nay có thể dồn tới 100 ảnh/ngày. Có cần giới hạn số bài game hiện ở feed không?
