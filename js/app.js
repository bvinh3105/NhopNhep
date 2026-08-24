/* ═══════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════ */
function boot() {
  Storage.load();
  TabNav.init();
  MapHome.init();
  HomeCtrl.init();
  ResultsCtrl.init();
  PlanCtrl.init();
  ProfileCtrl.init();
  AddModal.init();
  DetailModal.init();

  // Fallback default location — Hoàn Kiếm, Hà Nội
  State.userLat = 21.0285;
  State.userLng = 105.8542;
  document.getElementById('locInput').value = '📌 Hoàn Kiếm, Hà Nội (mẫu)';
  MapHome.setUserLocation(State.userLat, State.userLng, null, { center:true });

  // Silent GPS attempt if the context is secure
  GPS.silentFix();

  // Warn if not secure context
  if (!GPS.isSecure() && location.protocol === 'http:' && location.hostname !== 'localhost') {
    setTimeout(() => {
      GPS.hint('⚠️ GPS chỉ chạy qua HTTPS. Deploy Netlify hoặc dùng localhost để test', 'warn');
    }, 800);
  }
}

document.addEventListener('DOMContentLoaded', boot);
