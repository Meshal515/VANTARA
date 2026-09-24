package com.vantara.plugins

/**
 * مصادر «تكملة»: لغة ثانية من إضافة مثبّتة أصلًا، لا إضافة جديدة.
 *
 * العربي أولًا دائمًا. هذه لا تضيف أعمالًا للقوائم، وتملأ فقط الفصول التي
 * لا يملكها أي مصدر عربي لعملٍ موجود؛ ونزول الفصل العربي بعدها يغلبها. معرّفها
 * `<pkg>@<lang>`، فتشترك مع العربي في تحميل الحزمة نفسها.
 *
 * هنا لا في `dev/vantara/spike/Sources.kt`: ذاك نسخة مطابقة لما أثبته الـspike.
 */
data class FillerSpec(val pkg: String, val lang: String, val label: String)

val FILLER_SOURCES: List<FillerSpec> = listOf(
    FillerSpec(pkg = "eu.kanade.tachiyomi.extension.all.mangadex", lang = "en", label = "MangaDex"),
)

/** `pkg@lang` ← (pkg, lang)؛ بلا `@` هو المصدر العربي للحزمة. */
fun splitSourceId(sourceId: String): Pair<String, String?> {
    val at = sourceId.lastIndexOf('@')
    return if (at <= 0) sourceId to null else sourceId.substring(0, at) to sourceId.substring(at + 1).ifEmpty { null }
}
