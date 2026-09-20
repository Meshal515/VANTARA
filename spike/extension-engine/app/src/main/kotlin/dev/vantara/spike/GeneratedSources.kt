package dev.vantara.spike

/**
 * Fallback متتبَّع لخمسة المصادر المثبتة سابقًا.
 *
 * workflow الخاص بالـSpike يستبدل هذا الملف مؤقتًا بلقطة كل المصادر العربية
 * قبل البناء. إبقاء fallback يجعل المشروع قابلًا للبناء من checkout عادي.
 */
const val GENERATED_INDEX_COMMIT = "fallback-five"
const val GENERATED_SNAPSHOT_NOTE = "fallback: five previously proven SAFE sources"

val GENERATED_SPIKE_SOURCES: List<SourceSpec> = listOf(
    SourceSpec(
        label = "Mangalek",
        pkg = "eu.kanade.tachiyomi.extension.ar.mangalek",
        expectedLib = 1.4,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangalek-v1.4.65.apk",
        sha256 = "3474d105c5e7192b65ce1efd82a932fdc057375282d70838ca9950a1b97fc5a1",
        versionName = "1.4.65",
        warning = ContentWarning.SAFE,
        arabicSourceIds = emptySet(),
        arabicSourceNames = listOf("Mangalek"),
    ),
    SourceSpec(
        label = "MangaSpark",
        pkg = "eu.kanade.tachiyomi.extension.ar.mangaspark",
        expectedLib = 1.4,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangaspark-v1.4.60.apk",
        sha256 = "1912b552e3c1777c8ee797d7024ecffbc55108a14f883d16fdddca8074bceec3",
        versionName = "1.4.60",
        warning = ContentWarning.SAFE,
        arabicSourceIds = emptySet(),
        arabicSourceNames = listOf("MangaSpark"),
        query = "ناروتو",
    ),
    SourceSpec(
        label = "Azora",
        pkg = "eu.kanade.tachiyomi.extension.ar.azora",
        expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.azora-v1.6.73.apk",
        sha256 = "34c01978ce98c809ac47168ebb37b4c5abd14cc4fba10d15aa3c3103c5f668f0",
        versionName = "1.6.73",
        warning = ContentWarning.SAFE,
        arabicSourceIds = emptySet(),
        arabicSourceNames = listOf("Azora"),
    ),
    SourceSpec(
        label = "MangaSwat",
        pkg = "eu.kanade.tachiyomi.extension.ar.mangaswat",
        expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.mangaswat-v1.6.61.apk",
        sha256 = "a9d1cca2acd447d581fe6e1a00db68d352746eb18bab931077b2dd60b976917e",
        versionName = "1.6.61",
        warning = ContentWarning.SAFE,
        arabicSourceIds = emptySet(),
        arabicSourceNames = listOf("MangaSwat"),
        query = "سولو ليفلنج",
    ),
    SourceSpec(
        label = "Team X",
        pkg = "eu.kanade.tachiyomi.extension.ar.teamx",
        expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/6ca40f6-0/tachiyomi-ar.teamx-v1.6.33.apk",
        sha256 = "57292720171427ad511b53116e3f1b183185973ee961fd1bde19353d36d9d335",
        versionName = "1.6.33",
        warning = ContentWarning.SAFE,
        arabicSourceIds = emptySet(),
        arabicSourceNames = listOf("Team X"),
    ),
)
