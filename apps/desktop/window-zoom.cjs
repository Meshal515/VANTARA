'use strict';
/**
 * حجم الواجهة على شاشات الكمبيوتر الكبيرة، كتكبير ويندوز 125%/150% لكن من عرض النافذة نفسها.
 *
 * السبب الجذري (قياس الفحص الشامل، 13 نوفمبر): الواجهة صُممت ورُجعت على 1366، وعناصرها بمقاسات بكسل ثابتة
 * (صور الحلقات 176px، وجوه الشخصيات، أعمدة «إذا عجبك هذا» بحد أدنى 150px). على 1920 والشريط مقفل صار المحتوى
 * 11 عمودًا من بطاقات 139–152px، والبطولة نصف صف، وفراغات حولها: كل شيء أصغر من الشاشة.
 * هنا: النافذة الأعرض من ~1480 نقطة تُكبَّر بنسبة عرضها (حد 1.6)، فتبقى الصفحة بعرض CSS بين 1366 و1600 تقريبًا،
 * وهو المدى الذي صُمّمت عليه الأنماط وتُفحص عليه؛ النصوص والبطاقات والأزرار تكبر معًا بتناسب واحد.
 * إحداثيات الفيديو المدمج والطبقة تتحول من CSS إلى البكسل بنسبة العرض (video-host.cjs، player-overlay.cjs)،
 * فلا يتأثر موضع mpv بالتكبير. تكبير المستخدم من القائمة يُضرب فوق ذلك ويبقى.
 */
const BASE_WIDTH = 1480;
const MAX_AUTO = 1.6;

/** معامل التكبير لعرض محتوى النافذة (نقاط DIP بعد تكبير ويندوز). */
function fitZoom(contentWidth, user = 1) {
  const w = Number(contentWidth);
  const auto = Number.isFinite(w) && w > BASE_WIDTH ? Math.min(MAX_AUTO, w / BASE_WIDTH) : 1;
  const u = Number.isFinite(user) ? Math.min(2, Math.max(0.5, user)) : 1;
  return Math.round(auto * u * 100) / 100;
}

/**
 * يربط التكبير بنافذة: عند التحميل وتغيّر الحجم وملء الشاشة. يعيد أدوات تكبير المستخدم للقائمة.
 * `also` نوافذ تابعة (طبقة أدوات المشغل) تأخذ المعامل نفسه.
 */
function attachWindowZoom(window, { also = () => [] } = {}) {
  let user = 1, current = 1;
  // نافذة بلا أحداث أو مقاس (اختبارات الإقلاع المزيفة، أو منصة لا تدعم التكبير): بلا تكبير
  if (typeof window?.on !== 'function' || typeof window.getContentSize !== 'function' || typeof window.webContents?.setZoomFactor !== 'function')
    return { apply() {}, zoomIn() {}, zoomOut() {}, reset() {}, get factor() { return 1; } };
  const apply = () => {
    if (!window || window.isDestroyed()) return;
    const [width] = window.getContentSize();
    current = fitZoom(width, user);
    window.webContents.setZoomFactor(current);
    for (const child of also()) if (child && !child.isDestroyed()) child.webContents.setZoomFactor(current);
  };
  for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) window.on(event, apply);
  window.webContents.on('did-finish-load', apply);
  // Ctrl+العجلة: تكبير المستخدم نسبي فوق التلقائي، لا يلغيه
  window.webContents.on('zoom-changed', (_event, direction) => { user = Math.min(2, Math.max(0.5, user * (direction === 'in' ? 1.1 : 1 / 1.1))); apply(); });
  apply();
  return {
    apply,
    zoomIn: () => { user = Math.min(2, user * 1.1); apply(); },
    zoomOut: () => { user = Math.max(0.5, user / 1.1); apply(); },
    reset: () => { user = 1; apply(); },
    get factor() { return current; },
  };
}

module.exports = { fitZoom, attachWindowZoom, BASE_WIDTH, MAX_AUTO };
