package com.vantara.plugins

import java.net.URI

/**
 * محاولات جلب غلاف بترويسة Referer (بلاغ المالك 16 نوفمبر: أغلفة «آخر التحديثات» حروف). مصدر الغلاف قد لا يكون
 * مثبتًا على الجهاز (فصل المصادر المدمجة، وأحداث الأصدقاء)، فكان يُطلب بلا Referer وترفضه المواقع التي تحمي صورها.
 * الترتيب: ترويسات المصدر إن وُجدت (null = استعملها كما هي)، ثم جذر موقع الصورة، ثم مضيفها، ثم بلا Referer.
 */
object CoverReferers {
    fun attempts(url: String, hasSource: Boolean): List<String> {
        val host = runCatching { URI(url).host?.lowercase() }.getOrNull() ?: return listOf(NO_REFERER)
        val parts = host.split('.')
        val site = if (parts.size > 2) parts.takeLast(2).joinToString(".") else host
        return buildList {
            if (hasSource) add(SOURCE_HEADERS)
            add("https://$site/")
            if (host != site) add("https://$host/")
            add(NO_REFERER)
        }.distinct()
    }
    /** علامتان: ترويسات المصدر كما هي، وطلب بلا Referer. */
    const val SOURCE_HEADERS = "\u0000source"
    const val NO_REFERER = "\u0000none"
}
