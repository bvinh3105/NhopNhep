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

  // Fallback default location
  State.userLat = 10.7769;
  State.userLng = 106.7009;
  document.getElementById('locInput').value = '📌 Quận 1, TP. Hồ Chí Minh (mẫu)';
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
