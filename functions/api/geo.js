// Cloudflare Pages Function — trả vị trí ước tính từ IP người gọi.
// Path: /api/geo (từ functions/api/geo.js)
//
// Cloudflare gắn sẵn request.cf.{latitude,longitude,city,region,country}
// cho mọi request đi qua CDN — không tốn quota, không cần key, không
// cần user cấp quyền. Độ chính xác cỡ thành phố (không phải đường phố).
// Frontend dùng làm default location khi chưa có GPS + chưa có cache
// localStorage của lần dùng trước.

// App chỉ phục vụ đồ ăn VN, và IP-geo vốn là fallback THẤP NHẤT (chỉ
// override default HN, xem app.js) — nên một kết quả nằm ngoài khung VN
// gần như chắc chắn là IP-geo đoán sai (VPN, proxy, IP nhà mạng bị gán
// nhầm quốc gia trong DB của Cloudflare) chứ không phải người dùng thật
// đang ở đó. Trả null để frontend giữ nguyên default HN (đã ghi rõ là
// "ước tính" cho người dùng) thay vì thay bằng 1 toạ độ sai lệch trông
// như thật — bug thực tế: check-in bị gắn toạ độ Nam Mỹ trong khi máy ở
// VN, khiến "Đi tới" vẽ lộ trình 11,643km/xe máy vô lý (2026-09-24).
const VN_BOUNDS = { latMin: 7, latMax: 24, lngMin: 101, lngMax: 110 };

export async function onRequestGet({ request }) {
  const cf = request.cf || {};
  let lat = cf.latitude != null ? parseFloat(cf.latitude) : null;
  let lng = cf.longitude != null ? parseFloat(cf.longitude) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { lat = null; lng = null; }
  else if (lat < VN_BOUNDS.latMin || lat > VN_BOUNDS.latMax || lng < VN_BOUNDS.lngMin || lng > VN_BOUNDS.lngMax) {
    lat = null; lng = null;
  }
  const body = JSON.stringify({
    lat, lng,
    city: cf.city || null,
    region: cf.region || null,
    country: cf.country || null,
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Private — vị trí này riêng cho từng IP, không cache CDN chung.
      // 5 phút đủ tránh gọi lại trong cùng phiên nếu client reload nhanh.
      'Cache-Control': 'private, max-age=300',
    },
  });
}
