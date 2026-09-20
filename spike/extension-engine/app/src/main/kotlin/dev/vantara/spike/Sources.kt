package dev.vantara.spike

/**
 * نموذج مصدر واحد في Spike اكتشاف المصادر العربية.
 *
 * هذه ليست قائمة الإنتاج. الـworkflow يولّد `GeneratedSources.kt` من لقطة
 * **مثبّتة بــ commit** من فهرس Keiyoushi، ثم ينزّل كل APK في اللقطة ويحسِب
 * SHA-256 حقيقيًا قبل بناء الـAPK التجريبي.
 *
 * الدروس التي يفرضها هذا العقد:
 *  - لا نبني رابط APK من الاسم أو الإصدار؛ ننسخ `resources.apkUrl` كما نشره الفهرس.
 *  - «عربي» يعني أن `sources[].language == "ar"`، لا أن مجلد الإضافة تحت `src/ar`.
 *    بهذا ندخل الإضافات متعددة اللغات التي تحمل مصدرًا عربيًا أيضًا.
 *  - الحزمة قد تعرض عدة CatalogueSource؛ نختار معرّفات المصادر العربية نفسها،
 *    ولا نستعمل `first()` ونفترض أن الأول عربي.
 *  - contentWarning قيمة ثلاثية SAFE/MIXED/NSFW وتبقى محفوظة في التقرير.
 *  - BL/GL المتخصص يُحفظ في اللقطة لكن يُوسم BLOCKED ولا يُحمَّل أو يُشغَّل.
 */
enum class ContentWarning {
    SAFE,
    MIXED,
    NSFW,
}

data class SourceSpec(
    /** اسم الإضافة كما في index.json. */
    val label: String,
    val pkg: String,
    /** extensionLib المتوقع من الفهرس؛ المحمّل يطابقه مع MetaData داخل الـAPK. */
    val expectedLib: Double,
    /** الرابط الكامل كما نشره الفهرس. لا يُعاد تركيبه. */
    val apkUrl: String,
    /** SHA-256 للـAPK نفسه، محسوب في workflow من البايتات المنشورة. */
    val sha256: String,
    val versionName: String,
    val warning: ContentWarning,
    /** source.id للمصادر العربية داخل الحزمة. String لتجنّب أي مشكلة signed/unsigned. */
    val arabicSourceIds: Set<String>,
    /** أسماء المصادر العربية كما ظهرت في الفهرس، للتقرير فقط. */
    val arabicSourceNames: List<String>,
    /** استعلام أولي؛ المسبار يرجع لعنوان حي من popular إذا لم يجد نتيجة. */
    val query: String = "ون بيس",
    /** سياسة المالك: وجود سبب يعني أن المصدر ظاهر في التقرير فقط ولا يُشغَّل. */
    val blockedReason: String? = null,
)

/**
 * يولّده `tools/generate_arabic_sources.py` في workflow.
 *
 * الملف المتتبَّع في Git fallback صغير كي يبقى المشروع قابلًا للبناء محليًا؛
 * Artifact الـSpike الذي نجربه فعليًا يُبنى بعد استبداله باللقطة الكاملة.
 */
val SPIKE_SOURCES: List<SourceSpec>
    get() = GENERATED_SPIKE_SOURCES

val SPIKE_INDEX_COMMIT: String
    get() = GENERATED_INDEX_COMMIT

val SPIKE_SNAPSHOT_NOTE: String
    get() = GENERATED_SNAPSHOT_NOTE
