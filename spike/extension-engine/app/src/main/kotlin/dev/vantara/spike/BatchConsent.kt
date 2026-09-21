package dev.vantara.spike

/** Sensitive sources are never run without an explicit action in the UI. */
fun requiresExplicitConsent(warnings: Collection<ContentWarning>): Boolean =
    warnings.any { it != ContentWarning.SAFE }

/** Catalogue counting follows the approved batch; only owner-blocked sources stay excluded. */
fun shouldCrawlCatalogue(warning: ContentWarning, blockedReason: String?): Boolean {
    // Keep warning explicit so policy tests cover every supported classification.
    return warning in ContentWarning.entries && blockedReason == null
}

/** Exact content disclosure shown immediately before this spike starts. */
fun batchConsentCopy(warnings: Collection<ContentWarning>): String {
    val safe = warnings.count { it == ContentWarning.SAFE }
    val mixed = warnings.count { it == ContentWarning.MIXED }
    val nsfw = warnings.count { it == ContentWarning.NSFW }

    val mixedCopy = if (mixed == 1) "MangaDex واحد MIXED" else "$mixed مصادر MIXED"
    val nsfwCopy = when (nsfw) {
        0 -> "لا توجد مصادر NSFW في الدفعة"
        1 -> "مصدر عربي واحد NSFW"
        2 -> "مصدران عربيان NSFW"
        else -> "$nsfw مصادر NSFW"
    }
    val disclosure = if (nsfw == 0) {
        "قد يعرض MangaDex محتوى مختلطًا أثناء الفحص."
    } else {
        "قد تظهر صور فصول للبالغين أثناء الفحص."
    }
    return "$safe عربي SAFE · $mixedCopy · $nsfwCopy. $disclosure"
}
