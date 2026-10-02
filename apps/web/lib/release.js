/**
 * بيان إصدار VANTARA — مصدر واحد لما هو VANTARA الآن على المنصتين.
 *
 * VANTARA منتج واحد بمنصتين: APK (أندرويد) وPWA (المتصفح: آيفون، آيباد،
 * كمبيوتر). نشارك الهوية والحساب والبيانات والوظائف العامة، ونختلف فقط حين
 * تفرض قدرة المنصة ذلك. هذا الملف يقول من يملك ماذا، والواجهة تسأل
 * `supports(name)` في `lib/capabilities.js` ولا تسأل عن اسم المنصة أبدًا.
 *
 * ثلاثة أشياء هنا:
 *   features  ما تقدّمه كل منصة (ثابت حسب القدرة).
 *   flags     مفاتيح الميزات الجديدة: تُفعَّل لمنصة أو لحسابات بعينها أو تُطفأ
 *             بسرعة لو ظهر خلل (تعديل هنا + دمج ⇒ يصل مع التحديث التالي).
 *   releases  سجل التحديثات للمستخدم، كل بند موسوم shared / apk / pwa.
 *
 * نسخة البناء الفعلية لكل منصة مستقلة: الـAPK من CI (`appVersion()`)، والويب
 * من بصمة القشرة. `version` هنا هو إصدار المنتج الذي يصفه سجل التحديثات.
 */

export const RELEASE = Object.freeze({
  product: 'VANTARA',
  version: '0.1.0',
  releaseDate: '2026-10-02',

  /**
   * نسخة مخطط البيانات المحلية (localStorage/IndexedDB). رفعها يعني ترحيلًا
   * في `lib/migrations.js` يعمل قبل أن تقرأ الواجهة أي بيانات.
   */
  schemaVersion: 1,

  /** أقدم نسخة ما زالت تتكلم مع الخادم والبيانات بلا كسر. */
  minimumSupported: Object.freeze({ apk: '0.0.1', web: '0.1.0' }),

  /** apk + pwa = مشتركة. منصة واحدة = حصرية لها بسبب قدرتها. */
  features: Object.freeze({
    accounts: ['apk', 'pwa'],
    social: ['apk', 'pwa'],
    majlis: ['apk', 'pwa'],
    library: ['apk', 'pwa'],
    progress: ['apk', 'pwa'],
    history: ['apk', 'pwa'],
    recommendations: ['apk', 'pwa'],
    manga: ['apk', 'pwa'],
    anime: ['apk', 'pwa'],
    cinema: ['apk', 'pwa'],
    updates: ['apk', 'pwa'],

    rafiq: ['apk'],
    translation: ['apk'],
    autoTranslation: ['apk'],
    nativePlayer: ['apk'],
    nativeSources: ['apk'],
    apkUpdate: ['apk'],

    webInstall: ['pwa'],
    webUpdate: ['pwa'],
    webSources: ['pwa'],
    webPlayer: ['pwa'],
  }),

  /**
   * مفاتيح الميزات. `enabled: false` يطفئها في كل مكان (مفتاح الطوارئ).
   * `platforms` يحصرها في منصة، و`accounts` (أسماء المستخدمين) في حسابات
   * بعينها للتجربة قبل التعميم. ميزة تحت مفتاح تحتاج الاثنين: features + flag.
   */
  flags: Object.freeze({
    animeWebSources: { enabled: true, platforms: ['pwa'] },
    pwaCinema: { enabled: true, platforms: ['pwa'] },
    mangaWebSources: { enabled: true, platforms: ['pwa'] },
  }),

  releases: Object.freeze([
    {
      version: '0.1.0',
      date: '2026-10-02',
      items: [
        { kind: 'new', platforms: ['pwa'], text: 'VANTARA في المتصفح: آيفون وآيباد وكمبيوتر، بنفس حسابك ومكتبتك' },
        { kind: 'new', platforms: ['pwa'], text: 'المانجا والأنمي والسينما تشتغل من المتصفح مباشرة' },
        { kind: 'new', platforms: ['shared'], text: 'شاهد أنمي مصدر أنمي ثانٍ، وAnime4up بأدنى أولوية' },
        { kind: 'improve', platforms: ['shared'], text: 'تصميم جديد للإعدادات، وإحصائيات المتابعة في القائمة الجانبية' },
        { kind: 'fix', platforms: ['apk'], text: 'سيرفرات أسرع: مرايا StreamHG بطلب عادي بدل المتصفح المخفي' },
      ],
    },
  ]),
});

/** بنود السجل التي تخص منصة: المشتركة + الخاصة بها. الأحدث أولًا. */
export function releaseNotesFor(platform, releases = RELEASE.releases) {
  return releases
    .map((r) => ({ ...r, items: r.items.filter((it) => it.platforms.includes('shared') || it.platforms.includes(platform)) }))
    .filter((r) => r.items.length);
}
