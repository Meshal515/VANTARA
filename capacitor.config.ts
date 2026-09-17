import type { CapacitorConfig } from '@capacitor/cli';

/**
 * قشرة أندرويد.
 *
 * الواجهة تبقى كما هي: WebView يقدّم `apps/web` محليًا. لا إعادة كتابة Native
 * بلا داعٍ — المطلوب APK يُثبَّت ويُحدَّث، لا تطبيق مكتوب مرتين.
 *
 * `androidScheme: 'https'` يجعل أصل الصفحة `https://localhost`، وهو الأصل
 * المسموح في CORS عند الـWorker. تركه على `http` يعطي أصلًا آخر فيفشل كل طلب
 * مزامنة بخطأ يبدو كانقطاع شبكة.
 */
const config: CapacitorConfig = {
  appId: 'com.vantara.app',
  appName: 'VANTARA',
  webDir: 'apps/web',
  android: {
    // لا محتوى مختلط: خادم المحتوى يُوصل عبر Cloudflare Tunnel وهو https.
    // الاستثناء الوحيد للشبكة المحلية مضبوط في network_security_config.xml.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
  // أسود من أول إطار: الأبيض الافتراضي يُنتج وميضًا قبل تحميل الصفحة
  backgroundColor: '#000000',
};

export default config;
