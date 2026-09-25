package com.vantara.anime.stream

import kotlinx.serialization.Serializable

/**
 * «الطريق» كما تراه الواجهة: سيرفر في مصدر، بحالته الآن. ورقة السيرفرات في
 * الواجهة وورقة المشغّل تعرضان هذا نفسه، فلا يختلف ما يراه المستخدم بينهما.
 *
 * اسم السيرفر الحقيقي ([server]) لا يُعرض أبدًا: الواجهة تعرض [code] فقط.
 */
/** FAILED: جهز لكن فشل تشغيله (كل روابطه ماتت في المشغّل). */
enum class RouteState { RESOLVING, READY, UNAVAILABLE, FAILED }

@Serializable
data class Route(
    val id: String,
    val sourceId: String,
    val server: String,
    val code: String,
    val quality: Int? = null,
    val variant: Variant = Variant.UNKNOWN,
    val state: RouteState = RouteState.RESOLVING,
    val candidates: List<String> = emptyList(),
    /** سبب عدم الإتاحة، للتشخيص فقط. */
    val reason: String? = null,
)

/** ما يرسله المحوّل عن سيرفر: مفتاحه عنده، واسمه، وحالته. */
data class RouteReport(
    val sourceId: String,
    val key: String,
    val server: String,
    val quality: Int?,
    val variant: Variant,
    val state: RouteState,
    val candidates: List<Candidate> = emptyList(),
    val reason: String? = null,
)

/**
 * رموز قصيرة ثابتة بدل أسماء السيرفرات: نفس السيرفر نفس الرمز دائمًا، فيتعرّف
 * عليه المستخدم ويتذكره التطبيق («آخر سيرفر اخترته»)، بلا أسماء استضافات.
 */
object ServerCodes {
    private val KNOWN = mapOf(
        "hgcloud" to "HGC", "streamhg" to "HGC", "streamwish" to "SWH",
        "mp4upload" to "MPU", "google" to "GDR", "drive" to "GDR",
        "ok" to "OKR", "ok.ru" to "OKR", "okru" to "OKR",
        "videa" to "VDA", "4shared" to "FSH", "yonaplay" to "YNP",
        "vk" to "VKV", "megamax" to "MMX", "streamruby" to "RBY", "rubyvid" to "RBY",
        "uqload" to "UQL", "earnvids" to "EVD", "lulustream" to "LLS",
        "mixdrop" to "MXD", "krakenfiles" to "KRK", "voe" to "VOE", "dood" to "DDS",
        "doodstream" to "DDS", "filemoon" to "FMN", "mega" to "MEG", "sendvid" to "SVD",
    )

    fun code(server: String): String {
        val s = server.lowercase().trim()
        KNOWN[s]?.let { return it }
        KNOWN.entries.firstOrNull { s.contains(it.key) && it.key.length >= 3 }?.let { return it.value }
        val letters = s.filter { it.isLetterOrDigit() }.uppercase()
        val consonants = letters.filter { it !in "AEIOU" }
        return (consonants.ifEmpty { letters } + "XXX").take(3)
    }
}
