package com.vantara.downloads

/**
 * محتوى إشعار التنزيل، صافٍ وقابل للاختبار (DN1، DN2، طلب المالك: مثل Google Play).
 * - DN1: حين لا يبقى شيء يعمل، الإشعار «اكتمل» فورًا بلا أيقونة متحركة ولا شريط، ويقبل الإزالة. الخدمة نفسها تبقى خاملة
 *   دقيقتين (DS1) لكن المستخدم لا يرى «يجري التنزيل» بعد انتهائه.
 * - DN2: كل عنصر بسطره (حتى 4): الاسم، والنسبة، والسرعة. وفصول المانجا (تُنزَّل في الواجهة) بسطرها كما ترسله.
 */
data class NoticeItem(val title: String, val label: String, val bytes: Long, val total: Long, val bytesPerSecond: Long?)

data class NoticeContent(
    val title: String,
    val text: String,
    val lines: List<String>,
    /** 0..100، أو null بلا شريط (اكتمل، أو غير معروف). */
    val percent: Int?,
    val indeterminate: Boolean,
    val ongoing: Boolean,
    val done: Boolean,
)

object DownloadNotice {
    const val MAX_LINES = 4

    fun of(active: List<NoticeItem>, pending: Int, holds: List<String>, wifiOnly: Boolean, completed: Int): NoticeContent {
        // فصول المانجا تصل سطرًا لكل فصل في نص واحد
        @Suppress("NAME_SHADOWING") val holds = holds.flatMap { it.split('\n') }.map(String::trim).filter(String::isNotEmpty)
        if (active.isEmpty() && pending == 0 && holds.isEmpty()) {
            val title = if (completed > 1) "اكتمل تنزيل $completed عناصر" else "اكتمل التنزيل"
            return NoticeContent(title, "على الجهاز في VANTARA", emptyList(), null, indeterminate = false, ongoing = false, done = true)
        }
        val lines = (active.map(::line) + holds).take(MAX_LINES)
        val more = active.size + holds.size - lines.size
        val known = active.isNotEmpty() && active.all { it.total > 0 }
        val done = active.sumOf { it.bytes }
        val total = active.sumOf { if (it.total > 0) it.total else 0 }
        val percent = if (known) (done * 100 / total.coerceAtLeast(1)).toInt().coerceIn(0, 100) else null
        val speed = active.mapNotNull { it.bytesPerSecond }.takeIf { it.isNotEmpty() }?.sum()
        val count = active.size + holds.size
        val title = when {
            count == 0 -> if (wifiOnly) "$pending في الانتظار حتى Wi‑Fi" else "$pending في الانتظار"
            count == 1 -> active.firstOrNull()?.let { listOf(it.title, it.label).filter(String::isNotBlank).joinToString(" — ") } ?: holds.first()
            else -> "$count تنزيلات جارية"
        }
        val text = listOfNotNull(
            percent?.let { "$it%" },
            speed?.let(::rate),
            pending.takeIf { it > 0 && count > 0 }?.let { "$it في الانتظار" },
            more.takeIf { it > 0 }?.let { "و$it غيرها" },
        ).joinToString(" · ").ifEmpty { "VANTARA" }
        return NoticeContent(title, text, if (count > 1) lines else emptyList(), percent, indeterminate = percent == null, ongoing = true, done = false)
    }

    private fun line(i: NoticeItem): String = listOfNotNull(
        listOf(i.title, i.label).filter(String::isNotBlank).joinToString(" — ").ifEmpty { "تنزيل" },
        if (i.total > 0) "${(i.bytes * 100 / i.total).coerceIn(0, 100)}%" else null,
        i.bytesPerSecond?.let(::rate),
    ).joinToString(" · ")

    fun rate(bytesPerSecond: Long): String = when {
        bytesPerSecond >= 1_048_576 -> "%.1f MB/s".format(java.util.Locale.ROOT, bytesPerSecond / 1_048_576.0)
        bytesPerSecond >= 1024 -> "${bytesPerSecond / 1024} KB/s"
        else -> "$bytesPerSecond B/s"
    }
}
