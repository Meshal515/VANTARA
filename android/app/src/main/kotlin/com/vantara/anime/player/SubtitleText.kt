package com.vantara.anime.player

/**
 * ترجمة نصية (SRT/WebVTT) نعرضها بأنفسنا لا عبر Media3:
 *  - التأخير والتقديم بالاتجاهين: السطر يُختار بوقت المشغّل + الإزاحة، فالتقديم ممكن
 *    لأن الملف كله عندنا (Media3 لا يعطي سطرًا قبل موعده).
 *  - تغيير الترجمة لا يعيد تحميل الفيديو (كان الاختيار يبني MediaSource جديدًا ويحضّره).
 */
data class TimedCue(val startMs: Long, val endMs: Long, val text: String)

object SubtitleText {
    private val TIME = Regex("""(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})""")
    private val ARROW = Regex("""^\s*(\S+)\s*-->\s*(\S+)""")
    private val TAG = Regex("""<[^>]+>|\{\\[^}]*\}""")

    /** «00:01:02,500» أو «01:02.5» ← ميلي ثانية، أو null. */
    fun time(raw: String): Long? {
        val m = TIME.matchEntire(raw.trim()) ?: return null
        val h = m.groupValues[1].ifEmpty { "0" }.toLong()
        val min = m.groupValues[2].toLong()
        val s = m.groupValues[3].toLong()
        val frac = m.groupValues[4].padEnd(3, '0').toLong()
        if (min > 59 || s > 59) return null
        return ((h * 60 + min) * 60 + s) * 1000 + frac
    }

    /** يقرأ SRT وWebVTT معًا: كل كتلة فيها «بداية --> نهاية» ثم سطور النص. مرتّبة بالبداية. */
    fun parse(text: String): List<TimedCue> {
        val out = ArrayList<TimedCue>()
        val blocks = text.removePrefix("﻿").replace("\r\n", "\n").replace('\r', '\n').split(Regex("\n\\s*\n"))
        for (block in blocks) {
            val lines = block.split('\n')
            val at = lines.indexOfFirst { ARROW.containsMatchIn(it) }
            if (at < 0) continue
            val m = ARROW.find(lines[at]) ?: continue
            val start = time(m.groupValues[1]) ?: continue
            val end = time(m.groupValues[2]) ?: continue
            if (end <= start) continue
            val body = lines.drop(at + 1).map { it.replace(TAG, "").trim() }.filter { it.isNotEmpty() }
            if (body.isEmpty()) continue
            out.add(TimedCue(start, end, body.joinToString("\n")))
        }
        out.sortBy { it.startMs }
        return out
    }

    /** النص الظاهر عند [atMs] من وقت الملف (سطور متداخلة تظهر معًا)، أو "". */
    fun at(cues: List<TimedCue>, atMs: Long): String {
        if (cues.isEmpty()) return ""
        // آخر سطر بدأ قبل اللحظة، ثم الرجوع لمن ما زال ظاهرًا (السطور قصيرة غالبًا)
        var lo = 0; var hi = cues.size - 1; var last = -1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if (cues[mid].startMs <= atMs) { last = mid; lo = mid + 1 } else hi = mid - 1
        }
        if (last < 0) return ""
        val active = ArrayList<String>(2)
        var i = last
        while (i >= 0 && last - i < 16) {
            val c = cues[i]
            if (atMs < c.endMs) active.add(0, c.text)
            i--
        }
        return active.joinToString("\n")
    }

    /**
     * الإزاحة بلغة المستخدم: موجبة = الترجمة تتأخر (تظهر بعد الكلام)، سالبة = تظهر أبكر.
     * وقت الملف المطلوب = وقت الفيديو − الإزاحة.
     */
    fun fileTime(videoMs: Long, delayMs: Long) = videoMs - delayMs

    fun delayLabel(delayMs: Long): String = when {
        delayMs == 0L -> "بلا إزاحة"
        delayMs > 0 -> "تتأخر ${fmt(delayMs)} ث"
        else -> "أبكر ${fmt(-delayMs)} ث"
    }
    private fun fmt(ms: Long) = String.format(java.util.Locale.US, "%.1f", ms / 1000.0)
}
