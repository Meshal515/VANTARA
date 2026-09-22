package dev.vantara.spike

import eu.kanade.tachiyomi.source.CatalogueSource

/**
 * المصادر العربية المقصودة من حزمة، لا أول مصدر فيها.
 *
 * الإضافة متعددة اللغات (MangaDex) قد يكون أول CatalogueSource فيها
 * إنجليزيًا؛ `first()` كان سيعرض للقارئ العربي كتالوجًا إنجليزيًا بلا خطأ.
 * نطابق source.id الذي جاء من الفهرس، ولا نرجع إلى lang=ar إلا حين لا يطابق
 * أي معرّف (بيانٌ قديم بلا معرّفات، أو معرّف تغيّر).
 */
fun selectArabicSources(spec: SourceSpec, all: List<CatalogueSource>): List<CatalogueSource> {
    val exact = if (spec.arabicSourceIds.isNotEmpty()) {
        all.filter { it.id.toString() in spec.arabicSourceIds }
    } else {
        emptyList()
    }
    return exact.ifEmpty { all.filter { it.lang.equals("ar", ignoreCase = true) } }
}
