package dev.vantara.spike

/**
 * بيان المصادر المثبَّت.
 *
 * في النظام النهائي يسكن هذا في D1 ويُحدَّث بلا إصدار APK جديد. وفي هذا
 * الـspike مثبَّت في الكود بقصد: نُثبت المحرك لا نظام التحديث.
 *
 * و`sha256` ليس تزيينًا. تحميل الكود من ملف يتخلّى عن تحقّق التوقيع عبر
 * `PackageManager` — وهذا مُثبَت: `getPackageArchiveInfo` لا يعطي شهادة
 * لأرشيف غير مثبَّت. فالبصمة هي الضمانة، وهي تثبّت البايتات نفسها لا
 * الشهادة وحدها.
 *
 * البصمات أدناه محسوبة فعليًّا من القطع المنزَّلة في 2026‑09‑18.
 */
data class SourceSpec(
    /** الاسم كما يُعرض في الشاشة. */
    val label: String,
    val pkg: String,
    /** إصدار المكتبة المتوقَّع. تغيّره تغييرُ عقد، فيُعرض ولا يُطبَّق صامتًا. */
    val expectedLib: Double,
    /**
     * رابط القطعة **كاملًا كما ينشره الفهرس**، لا مبنيًّا من أجزاء.
     *
     * بناؤه يدويًّا أسقط أول تشغيل حقيقي بـ404 على الخمسة: الفهرس ينشر
     * الـAPK والـJAR تحت **وسمَي إصدار مختلفين** (`6ca40f6-0` للـAPK و
     * `19c8e5f-0` للـJAR)، وأنا أخذت وسم الـJAR وبنيت به رابط الـAPK.
     *
     * والدرس أوسع من الوسم: ما ينشره المصدر يُنسخ، ولا يُعاد تركيبه من
     * قواعد نستنبطها — فالقاعدة تنكسر بلا إشعار.
     */
    val apkUrl: String,
    val sha256: String,
    /** نصّ البحث العربي الذي نجرّبه على هذا المصدر. */
    val query: String,
)

/**
 * الخمسة، وكلها `CONTENT_WARNING_SAFE` في فهرس Keiyoushi.
 *
 * مقصودٌ أن تكون مزيجًا: اثنان على `lib 1.4` وثلاثة على `1.6`، فالـspike
 * يختبر العقدين لا واحدًا.
 */
val SPIKE_SOURCES: List<SourceSpec> = listOf(
    SourceSpec(
        label = "Mangalek",
        pkg = "eu.kanade.tachiyomi.extension.ar.mangalek",
        expectedLib = 1.4,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangalek-v1.4.65.apk",
        sha256 = "3474d105c5e7192b65ce1efd82a932fdc057375282d70838ca9950a1b97fc5a1",
        query = "ون بيس",
    ),
    SourceSpec(
        label = "MangaSpark",
        pkg = "eu.kanade.tachiyomi.extension.ar.mangaspark",
        expectedLib = 1.4,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangaspark-v1.4.60.apk",
        sha256 = "1912b552e3c1777c8ee797d7024ecffbc55108a14f883d16fdddca8074bceec3",
        query = "ناروتو",
    ),
    SourceSpec(
        label = "Azora",
        pkg = "eu.kanade.tachiyomi.extension.ar.azora",
        expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.azora-v1.6.73.apk",
        sha256 = "34c01978ce98c809ac47168ebb37b4c5abd14cc4fba10d15aa3c3103c5f668f0",
        query = "ون بيس",
    ),
    SourceSpec(
        label = "MangaSwat",
        pkg = "eu.kanade.tachiyomi.extension.ar.mangaswat",
        expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangaswat-v1.6.61.apk",
        sha256 = "a9d1cca2acd447d581fe6e1a00db68d352746eb18bab931077b2dd60b976917e",
        query = "سولو ليفلنج",
    ),
    SourceSpec(
        label = "Team X",
        pkg = "eu.kanade.tachiyomi.extension.ar.teamx",
        expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.teamx-v1.6.33.apk",
        sha256 = "57292720171427ad511b53116e3f1b183185973ee961fd1bde19353d36d9d335",
        query = "ون بيس",
    ),
)

