package com.vantara.anime.player

import com.vantara.anime.stream.TrackRef
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

/**
 * ترجمة مرفقة بالمصدر نفسه (CloudStream وغيره): تدخل Media3 ملفًا جانبيًا ([CandidateMediaSources])، فتصل أسطرها
 * لحظة موعدها ولا يمكن تقديمها. لكنها ملف له رابط، فعند طلب «أبكر» يُحمَّل الملف ويُعرض بأنفسنا كترجمات الإضافات
 * فيتحرك بالاتجاهين (بلاغ المالك 21 نوفمبر: «أبكر» لا تحرّك ترجمة الإضافة).
 * ترجمة مدمجة داخل ملف الفيديو نفسه لا رابط لها، فتبقى بموعدها كما كانت.
 */
object SidecarSubtitle {
    /**
     * الملف الجانبي للمسار المختار: يُطابَق بالاسم الذي أعطيناه للمسار عند إنشائه ([SubtitleLabels.of])، ثم باللغة إن
     * كان اسمه فريدًا. null = ليس ملفًا جانبيًا (مدمج في الفيديو) أو غير قاطع.
     */
    fun of(subtitles: List<TrackRef>, sourceName: String?, selectedLabel: String?, selectedLanguage: String?): TrackRef? {
        if (subtitles.isEmpty()) return null
        val labels = SubtitleLabels.of(subtitles, sourceName)
        if (selectedLabel != null) {
            val matches = labels.indices.filter { labels[it] == selectedLabel }
            if (matches.size == 1) return subtitles[matches[0]]
            if (matches.size > 1) return matches.firstOrNull { subtitles[it].lang.equals(selectedLanguage, true) }?.let { subtitles[it] }
        }
        return null
    }

    /** نص الملف: علامة الترميز أولًا، ثم ترميز الخادم، ثم UTF-8 صارمًا وإلا windows-1256 للعربية. */
    fun decode(bytes: ByteArray, declared: Charset?, arabic: Boolean): String {
        when {
            bytes.size >= 3 && bytes[0] == 0xef.toByte() && bytes[1] == 0xbb.toByte() && bytes[2] == 0xbf.toByte() -> return String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
            bytes.size >= 2 && bytes[0] == 0xff.toByte() && bytes[1] == 0xfe.toByte() -> return String(bytes, 2, bytes.size - 2, Charsets.UTF_16LE)
            bytes.size >= 2 && bytes[0] == 0xfe.toByte() && bytes[1] == 0xff.toByte() -> return String(bytes, 2, bytes.size - 2, Charsets.UTF_16BE)
        }
        if (declared != null) return String(bytes, declared)
        return try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: CharacterCodingException) {
            String(bytes, if (arabic) Charset.forName("windows-1256") else Charsets.ISO_8859_1)
        }
    }

    fun isArabic(lang: String): Boolean = lang.startsWith("ar", true) || lang.contains("عرب") || lang.equals("arabic", true)
}
