package com.vantara.downloads

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/**
 * عمل تنزيل أصلي: ملف واحد (حلقة أو فيلم) في مجلده الدائم.
 *
 * يُحفظ وصفه بجانب بياناته (`job.json`، كتابة ذرية): إعادة تشغيل الجهاز أو قتل العملية لا تضيع
 * ما نُزّل، والاستئناف يعرف من أي بايت/مقطع يكمل ومن أي مصدر بدأ.
 */
@Serializable
data class DownloadJob(
    val id: String,
    /** مفتاح المصدر والسيرفر الذي بدأ منه الملف. رابط جديد من غيره لا يُكمل هذا الملف (لا خلط). */
    val sourceKey: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    /** HLS أو FILE (MP4/MKV/WebM مباشر) أو TORRENT (ملف من تورنت، يُحفظ كاملًا). */
    val kind: String,
    val sourceId: String = "",
    val quality: Int? = null,
    val title: String = "",
    val label: String = "",
    val section: String = "anime",
    val subtitles: List<Sidecar> = emptyList(),
    val audio: List<Sidecar> = emptyList(),
    val state: String = "queued",
    val bytes: Long = 0,
    val total: Long = -1,
    val etag: String? = null,
    val lastModified: String? = null,
    /** HLS: عدد المقاطع المحفوظة من الإجمالي. */
    val segmentsDone: Int = 0,
    val segmentsTotal: Int = 0,
    /** الملف الرئيسي النهائي (نسبي للمجلد): video.mkv أو index.m3u8. */
    val main: String? = null,
    val container: String? = null,
    val verified: Boolean = false,
    val mainBytes: Long? = null,
    val error: String? = null,
    val message: String? = null,
    /** التورنت: البصمة ورقم الملف والرابط بمتتبّعاته — يكفي لإعادة الإضافة والاستئناف بعد إعادة التشغيل. */
    val torrentHash: String? = null,
    val torrentFile: Int? = null,
    val torrentMagnet: String? = null,
    val peers: Int = 0,
    /** ترجمات الإضافات: هوية الحلقة وقائمة الإضافات (JSON كما يمرّرها المشغّل) ورقم الحلقة. */
    val subtitleIdentity: String? = null,
    val subtitleProviders: String? = null,
    val episode: Float = 1f,
    val addonSubtitlesDone: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val finishedAt: Long? = null,
)

@Serializable
data class Sidecar(val url: String, val lang: String, val file: String? = null, val kind: String = "subtitle", /** الإضافة/المصدر الذي جاءت منه. */ val label: String? = null)

class DownloadFailure(val code: String, message: String) : Exception(message)

/** ترجمة إضافة جُلبت للحفظ بجانب الملف: لغتها ونصها (UTF-8) وامتدادها واسم الإضافة. */
data class SavedSubtitle(val lang: String, val text: String, val ext: String, val provider: String? = null)

/** مجلد التنزيلات الدائم وبيانات كل عمل. */
class JobStore(val root: File) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    init { root.mkdirs() }

    /** اسم المجلد من معرّف الواجهة وحده (dl_ + حروف وأرقام): لا مسار من نص خارجي. */
    fun dir(id: String): File {
        require(Regex("^dl_[a-z0-9]{2,40}$").matches(id)) { "معرّف تنزيل غير صالح" }
        return File(root, id)
    }

    fun read(id: String): DownloadJob? = runCatching {
        json.decodeFromString(DownloadJob.serializer(), File(dir(id), "job.json").readText())
    }.getOrNull()

    fun write(job: DownloadJob) {
        val d = dir(job.id).apply { mkdirs() }
        val tmp = File(d, "job.json.tmp")
        tmp.writeText(json.encodeToString(DownloadJob.serializer(), job))
        if (!tmp.renameTo(File(d, "job.json"))) {
            File(d, "job.json").delete()
            tmp.renameTo(File(d, "job.json"))
        }
    }

    fun all(): List<DownloadJob> = root.listFiles()?.filter { it.isDirectory }?.mapNotNull { runCatching { read(it.name) }.getOrNull() }.orEmpty()

    fun delete(id: String) {
        dir(id).deleteRecursively()
    }

    fun sizeOnDisk(id: String): Long = dir(id).walkTopDown().filter { it.isFile && it.name != "job.json" }.sumOf { it.length() }
}

/** نوع الحاوية من أول بايتاتها: صفحة HTML ليست فيديو مهما قال اسمها. */
object Signatures {
    fun sniff(head: ByteArray, contentType: String? = null): String {
        fun at(i: Int) = if (i < head.size) head[i].toInt() and 0xff else -1
        val ct = contentType?.lowercase().orEmpty()
        return when {
            at(0) == 0x1A && at(1) == 0x45 && at(2) == 0xDF && at(3) == 0xA3 -> if ("webm" in ct) "WEBM" else "MKV"
            at(4) == 'f'.code && at(5) == 't'.code && at(6) == 'y'.code && at(7) == 'p'.code -> "MP4"
            at(0) == 0x47 && (head.size < 189 || at(188) == 0x47) -> "TS"
            head.size >= 7 && String(head, 0, minOf(head.size, 7), Charsets.US_ASCII) == "#EXTM3U" -> "HLS"
            "mpegurl" in ct -> "HLS"
            "dash+xml" in ct -> "DASH"
            "text/html" in ct || head.take(64).toByteArray().toString(Charsets.UTF_8).trimStart().let { it.startsWith("<!DOCTYPE", true) || it.startsWith("<html", true) } -> "PAGE"
            else -> "UNKNOWN"
        }
    }

    fun extension(container: String?): String = when (container) {
        "MP4" -> "mp4"
        "WEBM" -> "webm"
        "TS" -> "ts"
        else -> "mkv"
    }
}
