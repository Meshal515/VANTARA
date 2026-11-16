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
    /**
     * المحاولة التالية تغيّر Referer وحده، فلا تفيد إلا إذا رفض الموقع بسبب Referer (401/403) أو أعاد شيئًا ليس صورة
     * (صفحة حماية الروابط). انقطاع أو مهلة أو 404 أو 5xx = توقّف فورًا: كانت تُكرَّر حتى 4 مرات متتالية فيتأخر الحرف.
     * [status] null = لم يصل رد (استثناء شبكة أو مهلة).
     */
    fun worthNextAttempt(status: Int?, gotNonImage: Boolean): Boolean =
        gotNonImage || status == 401 || status == 403

    /** سقف الغلاف كله بكل محاولاته: يظهر خلال ثوانٍ، وما لم يصل يأخذ الحرف ولا يحجز غيره. */
    const val BUDGET_MS = 6_000L

    /** علامتان: ترويسات المصدر كما هي، وطلب بلا Referer. */
    const val SOURCE_HEADERS = "\u0000source"
    const val NO_REFERER = "\u0000none"
}
