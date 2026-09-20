package dev.vantara.spike

/** Sensitive sources are never run without an explicit action in the UI. */
fun requiresExplicitConsent(warnings: Collection<ContentWarning>): Boolean =
    warnings.any { it != ContentWarning.SAFE }

/** Exact content disclosure shown immediately before this spike starts. */
fun batchConsentCopy(warnings: Collection<ContentWarning>): String {
    val safe = warnings.count { it == ContentWarning.SAFE }
    val mixed = warnings.count { it == ContentWarning.MIXED }
    val nsfw = warnings.count { it == ContentWarning.NSFW }

    val mixedCopy = if (mixed == 1) "MangaDex واحد MIXED" else "$mixed مصادر MIXED"
    val nsfwCopy = if (nsfw == 2) "مصدران عربيان NSFW" else "$nsfw مصادر NSFW"
    return "$safe عربي SAFE · $mixedCopy · $nsfwCopy. " +
        "قد تظهر صور فصول للبالغين أثناء الفحص."
}
