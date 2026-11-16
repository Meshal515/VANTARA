package com.vantara.anime.player

import com.vantara.anime.stream.TrackRef
import java.util.Locale

/**
 * أسماء الترجمات في قائمة المشغّل. كانت كل ترجمة تُسمّى برمز لغتها («ar»، «ar»، «ar»…) فلا يُعرف
 * من أي إضافة أو مصدر جاءت: الاسم الآن «العربية · OpenSubtitles»، والمتكرر بنفس الاسم يُرقّم.
 */
object SubtitleLabels {
    private val arabic = Locale("ar")

    /** «العربية» من «ar» أو «ara» أو «Arabic»؛ النص الحر كما هو. */
    fun language(code: String): String {
        val raw = code.trim()
        if (raw.isEmpty() || raw.equals("und", true)) return "ترجمة"
        if (raw.any { it.code > 127 }) return raw
        val tag = when (raw.lowercase()) { "ara", "arabic" -> "ar"; "eng", "english" -> "en"; else -> raw }
        val name = Locale.forLanguageTag(tag.replace('_', '-')).getDisplayLanguage(arabic)
        return if (name.isBlank() || name.equals(tag, true)) raw else name
    }

    /** اسم لكل مسار بترتيبه: اللغة، ثم الإضافة/المصدر، ثم رقم إن تكرر الاسم نفسه. */
    fun of(tracks: List<TrackRef>, fallbackSource: String?): List<String> {
        val base = tracks.map { t ->
            val from = t.label?.trim()?.takeIf { it.isNotEmpty() } ?: fallbackSource?.trim()?.takeIf { it.isNotEmpty() && it != "local" }
            if (from == null) language(t.lang) else "${language(t.lang)} · $from"
        }
        val total = base.groupingBy { it }.eachCount()
        val seen = HashMap<String, Int>()
        return base.map { name ->
            if ((total[name] ?: 0) < 2) name else "$name ${seen.merge(name, 1, Int::plus)}"
        }
    }
}
