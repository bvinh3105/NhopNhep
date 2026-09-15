// Cloudflare Pages Function — trả vị trí ước tính từ IP người gọi.
// Path: /api/geo (từ functions/api/geo.js)
//
// Cloudflare gắn sẵn request.cf.{latitude,longitude,city,region,country}
// cho mọi request đi qua CDN — không tốn quota, không cần key, không
// cần user cấp quyền. Độ chính xác cỡ thành phố (không phải đường phố).
// Frontend dùng làm default location khi chưa có GPS + chưa có cache
// localStorage của lần dùng trước.

export async function onRequestGet({ request }) {
  const cf = request.cf || {};
  const lat = cf.latitude != null ? parseFloat(cf.latitude) : null;
  const lng = cf.longitude != null ? parseFloat(cf.longitude) : null;
  const body = JSON.stringify({
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
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
