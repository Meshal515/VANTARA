package com.vantara.plugins

import dev.vantara.spike.ContentWarning
import dev.vantara.spike.SourceSpec

/**
 * مصادر «تكملة» إنجليزية: تملأ الفصول التي لا يملكها أي مصدر عربي.
 *
 * العربي أولًا دائمًا. هذه لا تضيف أعمالًا للقوائم، وتملأ فقط فصول عملٍ له
 * نسخة عربية؛ ونزول الفصل العربي بعدها يغلبها. معرّفها `<pkg>@<lang>`.
 *
 * نوعان: لغة ثانية من إضافة مثبّتة أصلًا (MangaDex)، أو إضافة إنجليزية
 * مستقلة مثبّتة هنا بصمةً وإصدارًا (`FILLER_PACKAGES`) — تُحمَّل بنفس المحمّل
 * ونفس التحقق، ومضمّنة في التطبيق (`tools/bundle-extensions.mjs`).
 *
 * هنا لا في `dev/vantara/spike/Sources.kt`: ذاك نسخة مطابقة لما أثبته الـspike.
 */
data class FillerSpec(
    val pkg: String,
    val lang: String,
    val label: String,
    /** source.id بعينه داخل الحزمة إن كانت متعددة اللغات؛ وإلا أول مصدر بلغة `lang`. */
    val sourceId: String? = null,
)

/**
 * الإضافات الإنجليزية المستقلة. من فهرس Keiyoushi (commit d80bff27a628)،
 * والبصمة من `release-assets.json` نفسه ومطابقة لما نُزِّل.
 *
 * اختيرت بتجربة فعلية للإضافة نفسها: بحث (Solo Leveling وOne Piece وOmniscient
 * Reader) ثم فصول ثم صفحات ثم صورة، بلا تحدّي Cloudflare.
 */
val FILLER_PACKAGES: List<SourceSpec> = listOf(
    SourceSpec(
        label = "Weeb Central",
        pkg = "eu.kanade.tachiyomi.extension.en.weebcentral",
        expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/8ef06cd-1/tachiyomi-en.weebcentral-v1.6.25.apk",
        sha256 = "04331a9b4bb878325dfca1079757c9152cdf66916f7859d0dddf41cf26553d30",
        versionName = "1.6.25",
        warning = ContentWarning.MIXED,
        arabicSourceIds = emptySet(),
        arabicSourceNames = listOf("Weeb Central"),
    ),
    SourceSpec(
        label = "Asura Scans",
        pkg = "eu.kanade.tachiyomi.extension.en.asurascans",
        expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/4217666-0/tachiyomi-en.asurascans-v1.6.69.apk",
        sha256 = "559144ddf25bc7f348efa523318e45b7544727a55f3c5ddc4bd91b3a861295f3",
        versionName = "1.6.69",
        warning = ContentWarning.SAFE,
        arabicSourceIds = emptySet(),
        arabicSourceNames = listOf("Asura Scans"),
    ),
    SourceSpec(
        label = "MangaFire",
        pkg = "eu.kanade.tachiyomi.extension.all.mangafire",
        expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/4217666-0/tachiyomi-all.mangafire-v1.6.34.apk",
        sha256 = "bc5d23a565f1e752cdb244788646bd2728363802ce0823c70b168e7f48e41fad",
        versionName = "1.6.34",
        warning = ContentWarning.MIXED,
        arabicSourceIds = emptySet(),
        arabicSourceNames = listOf("MangaFire"),
    ),
    SourceSpec(
        label = "Mangakakalot",
        pkg = "eu.kanade.tachiyomi.extension.en.mangakakalot",
        expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/4217666-0/tachiyomi-en.mangakakalot-v1.6.24.apk",
        sha256 = "addc45ba37145f142d4088bd28b7c062a1d1ce1c3bf75054890773624f4cfc6e",
        versionName = "1.6.24",
        warning = ContentWarning.MIXED,
        arabicSourceIds = emptySet(),
        arabicSourceNames = listOf("Mangakakalot"),
    ),
    SourceSpec(
        label = "Mangahere",
        pkg = "eu.kanade.tachiyomi.extension.en.mangahere",
        expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/8ef06cd-0/tachiyomi-en.mangahere-v1.6.1.apk",
        sha256 = "5387cfec7d395d5f30bff03fcf92527b9c94a183b83d044c8282dd35b28ec508",
        versionName = "1.6.1",
        warning = ContentWarning.MIXED,
        arabicSourceIds = emptySet(),
        arabicSourceNames = listOf("Mangahere"),
    ),
)

val FILLER_SOURCES: List<FillerSpec> = listOf(
    FillerSpec(pkg = "eu.kanade.tachiyomi.extension.all.mangadex", lang = "en", label = "MangaDex"),
    FillerSpec(pkg = "eu.kanade.tachiyomi.extension.en.weebcentral", lang = "en", label = "Weeb Central", sourceId = "2131019126180322627"),
    FillerSpec(pkg = "eu.kanade.tachiyomi.extension.en.asurascans", lang = "en", label = "Asura Scans", sourceId = "6247824327199706550"),
    FillerSpec(pkg = "eu.kanade.tachiyomi.extension.all.mangafire", lang = "en", label = "MangaFire", sourceId = "6084907896154116083"),
    FillerSpec(pkg = "eu.kanade.tachiyomi.extension.en.mangakakalot", lang = "en", label = "Mangakakalot", sourceId = "2528986671771677900"),
    FillerSpec(pkg = "eu.kanade.tachiyomi.extension.en.mangahere", lang = "en", label = "Mangahere", sourceId = "2"),
)

/** `pkg@lang` ← (pkg, lang)؛ بلا `@` هو المصدر العربي للحزمة. */
fun splitSourceId(sourceId: String): Pair<String, String?> {
    val at = sourceId.lastIndexOf('@')
    return if (at <= 0) sourceId to null else sourceId.substring(0, at) to sourceId.substring(at + 1).ifEmpty { null }
}

/** بيان الحزمة: من لقطة المصادر العربية، أو من الإضافات الإنجليزية المستقلة. */
fun packageSpec(pkg: String): SourceSpec? =
    dev.vantara.spike.SPIKE_SOURCES.firstOrNull { it.pkg == pkg } ?: FILLER_PACKAGES.firstOrNull { it.pkg == pkg }
