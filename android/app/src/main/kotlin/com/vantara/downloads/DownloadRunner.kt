package com.vantara.downloads

import java.io.File

/**
 * ينفّذ عمل تنزيل واحد حتى نهايته: الملف الرئيسي ثم ملفات الصوت والترجمة الخارجية،
 * ثم التحقق. لا يعرف شيئًا عن الواجهة: يكتب حالته في [JobStore] ويبلّغ [Listener].
 *
 * الحاوية تُحفظ كما هي (MKV بمساراته الصوتية والترجمات المدمجة يبقى MKV): لا إعادة ترميز ولا حذف مسارات.
 */
class DownloadRunner(
    private val store: JobStore,
    private val transfers: Transfers,
    /** محرك التورنت الدائم (TorrentEngine.downloadPermanent)؛ null حيث لا يتوفر (الاختبارات). */
    private val torrent: ((DownloadJob, File, (DownloadJob) -> Unit) -> File)? = null,
    /** ترجمات الإضافات المثبتة لهذه الحلقة: (اللغة، النص UTF-8، الامتداد). null حيث لا تتوفر. */
    private val addonSubtitles: ((DownloadJob) -> List<SavedSubtitle>)? = null,
) {
    fun interface Listener { fun on(job: DownloadJob) }

    private var last = 0L

    private fun save(job: DownloadJob, listener: Listener, force: Boolean = true): DownloadJob {
        val now = System.currentTimeMillis()
        if (force || now - last >= 1500) {
            store.write(job)
            last = now
        }
        listener.on(job)
        return job
    }

    fun run(start: DownloadJob, listener: Listener): DownloadJob {
        var job = save(start.copy(state = "downloading", error = null, message = null), listener)
        val dir = store.dir(job.id)
        job = when (job.kind) {
            "HLS" -> hls(job, dir, listener)
            "TORRENT" -> torrentFile(job, dir, listener)
            else -> file(job, dir, listener)
        }
        // الملف كامل: «يتحقق» من الآن، لا «يحمّل 100%» طوال جلب الترجمات والصوت الخارجي
        job = save(job.copy(state = "verifying"), listener)
        job = sidecars(job, dir, listener)
        val main = job.main?.let { File(dir, it) }
        if (main == null || !main.isFile || main.length() <= 0) throw DownloadFailure("VERIFY", "الملف الرئيسي غير موجود بعد التنزيل")
        if (job.kind == "FILE") {
            val head = main.inputStream().use { s -> ByteArray(512).let { b -> val n = s.read(b); b.copyOf(maxOf(n, 0)) } }
            val sniffed = Signatures.sniff(head)
            if (sniffed == "PAGE" || sniffed == "HLS" || sniffed == "UNKNOWN") throw DownloadFailure("VERIFY", "المحفوظ ليس ملف فيديو ($sniffed)")
            if (job.total > 0 && main.length() != job.total) throw DownloadFailure("VERIFY", "حجم الملف ${main.length()} لا يطابق ${job.total}")
        }
        val size = store.sizeOnDisk(job.id)
        return save(job.copy(state = "ready", verified = true, bytes = size, total = size, finishedAt = System.currentTimeMillis()), listener)
    }

    /** التورنت: الملف كاملًا في مجلد العنصر، وكل قطعة متحقق من بصمتها قبل عدّها. */
    private fun torrentFile(start: DownloadJob, dir: File, listener: Listener): DownloadJob {
        val engine = torrent ?: throw DownloadFailure("UNSUPPORTED", "محرك التورنت غير متاح على هذا الجهاز")
        var job = start
        val out = engine(job, File(dir, "t")) { next -> job = next; save(job, listener, force = false) }
        if (!out.isFile || out.length() <= 0) throw DownloadFailure("VERIFY", "ملف التورنت غير موجود بعد التنزيل")
        val head = out.inputStream().use { s -> ByteArray(512).let { b -> val n = s.read(b); b.copyOf(maxOf(n, 0)) } }
        val container = Signatures.sniff(head).takeIf { it != "UNKNOWN" } ?: out.extension.uppercase()
        return job.copy(main = out.relativeTo(dir).path, container = container, bytes = out.length(), total = out.length())
    }

    private fun file(start: DownloadJob, dir: File, listener: Listener): DownloadJob {
        var job = start
        val part = File(dir, "video.part")
        val validator = job.etag?.takeIf { !it.startsWith("W/") } ?: job.lastModified
        val (size, etag, modified) = transfers.file(job.url, job.headers, part, validator) { bytes, total ->
            job = job.copy(bytes = bytes, total = total)
            save(job, listener, force = false)
        }
        job = job.copy(etag = etag ?: job.etag, lastModified = modified ?: job.lastModified, bytes = size, total = size)
        val head = part.inputStream().use { s -> ByteArray(512).let { b -> val n = s.read(b); b.copyOf(maxOf(n, 0)) } }
        val container = Signatures.sniff(head)
        val name = "video.${Signatures.extension(container)}"
        val dest = File(dir, name)
        if (!part.renameTo(dest)) {
            dest.delete()
            if (!part.renameTo(dest)) throw DownloadFailure("STORAGE", "تعذّر إنهاء الملف")
        }
        return job.copy(main = name, container = container)
    }

    /**
     * HLS: القائمة الرئيسية ← نسخة الفيديو ومسارات الصوت والترجمة ← كل المقاطع ← قوائم محلية.
     * المقطع المحفوظ لا يُعاد؛ الاستئناف يبدأ من أول مقطع ناقص.
     */
    private fun hls(start: DownloadJob, dir: File, listener: Listener): DownloadJob {
        var job = start
        val text = transfers.text(job.url, job.headers)
        val playlists = mutableListOf<Pair<String, String>>() // (اسم محلي، رابط)
        var master: HlsPlaylist.Master? = null
        val renditionLines = mutableListOf<String>()
        val streamLine: String
        if (HlsPlaylist.isMaster(text)) {
            val m = HlsPlaylist.parseMaster(text, job.url)
            master = m
            val v = HlsPlaylist.chooseVariant(m, job.quality) ?: throw DownloadFailure("SOURCE", "قائمة HLS بلا نسخ")
            playlists += "video.m3u8" to v.uri
            for ((i, r) in m.renditions.filter { (it.groupId == v.audioGroup && it.type == "AUDIO") || (it.groupId == v.subtitleGroup && it.type == "SUBTITLES") }.withIndex()) {
                val local = if (r.uri != null) "${r.type.lowercase()}-$i.m3u8".also { playlists += it to r.uri } else null
                renditionLines += buildString {
                    append("#EXT-X-MEDIA:TYPE=").append(r.type).append(",GROUP-ID=\"").append(r.groupId).append('"')
                    r.language?.let { append(",LANGUAGE=\"").append(it).append('"') }
                    append(",NAME=\"").append(r.name ?: r.language ?: "track $i").append('"')
                    append(",DEFAULT=").append(if (r.default) "YES" else "NO").append(",AUTOSELECT=YES")
                    local?.let { append(",URI=\"").append(it).append('"') }
                }
            }
            streamLine = buildString {
                append("#EXT-X-STREAM-INF:BANDWIDTH=").append(v.bandwidth.coerceAtLeast(1))
                v.codecs?.let { append(",CODECS=\"").append(it).append('"') }
                v.audioGroup?.let { append(",AUDIO=\"").append(it).append('"') }
                v.subtitleGroup?.let { append(",SUBTITLES=\"").append(it).append('"') }
            }
        } else {
            playlists += "video.m3u8" to job.url
            streamLine = "#EXT-X-STREAM-INF:BANDWIDTH=1"
        }

        // كل القوائم أولًا: نعرف إجمالي المقاطع قبل البدء، ونرفض المحمي قبل تنزيل أي بايت
        val medias = playlists.map { (local, url) ->
            val body = if (local == "video.m3u8" && master == null) text else transfers.text(url, job.headers)
            val media = HlsPlaylist.parseMedia(body, url)
            if (media.drm) throw DownloadFailure("DRM", "المحتوى محمي")
            if (!media.endList) throw DownloadFailure("UNSUPPORTED", "بث مباشر لا ملف")
            if (media.segments.isEmpty()) throw DownloadFailure("SOURCE", "قائمة بلا مقاطع")
            Triple(local, url, media)
        }
        val total = medias.sumOf { it.third.segments.size }
        var done = 0
        var bytes = 0L
        job = job.copy(segmentsTotal = total)
        for ((pi, triple) in medias.withIndex()) {
            val (local, _, media) = triple
            val folder = File(dir, "p$pi").apply { mkdirs() }
            val keys = LinkedHashMap<String, String>()
            val maps = LinkedHashMap<String, String>()
            var previousEnd = 0L
            for ((i, s) in media.segments.withIndex()) {
                s.key?.uri?.let { uri ->
                    if (uri !in keys) {
                        val name = "k${keys.size}.key"
                        val f = File(folder, name)
                        if (!f.isFile || f.length() != 16L) transfers.whole(uri, job.headers, f)
                        if (f.length() != 16L) throw DownloadFailure("DRM", "مفتاح غير قياسي")
                        keys[uri] = name
                    }
                }
                s.map?.let { m ->
                    val k = m + "|" + (s.mapByteRange ?: "")
                    if (k !in maps) {
                        val name = "init${maps.size}.mp4"
                        val f = File(folder, name)
                        if (!f.isFile || f.length() == 0L) transfers.whole(m, job.headers, f, HlsPlaylist.byteRange(s.mapByteRange, 0))
                        maps[k] = name
                    }
                }
                val seg = File(folder, "s$i.seg")
                val range = HlsPlaylist.byteRange(s.byteRange, previousEnd)
                if (range != null) previousEnd = range.last + 1
                if (!seg.isFile || seg.length() == 0L) {
                    Transfers.ensureSpace(seg, 32L * 1024 * 1024)
                    transfers.whole(s.uri, job.headers, seg, range)
                }
                bytes += seg.length()
                done++
                job = job.copy(segmentsDone = done, bytes = bytes)
                // الإجمالي تقدير من متوسط المقاطع المحفوظة: يظهر نسبة صادقة بالمقاطع لا بالبايت المختلق
                listener.on(job.copy(total = if (done > 0) bytes * total / done else -1))
                if (done % 8 == 0) store.write(job)
            }
            val localText = HlsPlaylist.localMedia(media, { "p$pi/s$it.seg" }, { k -> k.uri?.let { keys[it] }?.let { "p$pi/$it" } }, { "p$pi/" + maps.getValue(it) })
            File(dir, local).writeText(localText)
        }
        val index = buildString {
            append("#EXTM3U\n#EXT-X-VERSION:6\n")
            renditionLines.forEach { append(it).append('\n') }
            append(streamLine).append('\n').append("video.m3u8\n")
        }
        File(dir, "index.m3u8").writeText(index)
        return job.copy(main = "index.m3u8", container = "HLS", bytes = bytes, total = bytes)
    }

    /** ملفات الترجمة والصوت الخارجية بجانب الفيديو، بأسماء آمنة وامتداداتها الأصلية (التوقيت كما هو). */
    private fun sidecars(start: DownloadJob, dir: File, listener: Listener): DownloadJob {
        var job = start
        fun ext(url: String, fallback: String): String {
            val path = runCatching { java.net.URI(url).path.orEmpty() }.getOrDefault("")
            val e = path.substringAfterLast('.', "").lowercase()
            return if (e in setOf("srt", "vtt", "ass", "ssa", "ttml", "m4a", "aac", "mp3", "opus", "ogg", "mka", "m3u8")) e else fallback
        }
        val subs = job.subtitles.mapIndexed { i, s ->
            if (s.file != null && File(dir, s.file).isFile) return@mapIndexed s
            val name = "sub-$i.${ext(s.url, "vtt")}"
            runCatching { transfers.whole(s.url, job.headers, File(dir, name)) }.fold({ s.copy(file = name) }, { s })
        }
        val audio = job.audio.mapIndexed { i, a ->
            if (a.file != null && File(dir, a.file).isFile) return@mapIndexed a
            val e = ext(a.url, "m4a")
            if (e == "m3u8") return@mapIndexed a // صوت HLS خارجي: يبقى في القائمة الرئيسية إن كان منها، ولا يُخترع ملف
            val name = "audio-$i.$e"
            runCatching { transfers.whole(a.url, job.headers, File(dir, name)) }.fold({ a.copy(file = name) }, { a })
        }
        job = job.copy(subtitles = subs, audio = audio)
        // ترجمات الإضافات (OpenSubtitles وغيرها): نص UTF-8 بجانب الفيديو، فلا ينكسر ترميز العربية بلا إنترنت
        val fetchSubtitles = addonSubtitles
        if (!job.addonSubtitlesDone && fetchSubtitles != null && job.subtitleProviders != null) {
            val fetched = runCatching { fetchSubtitles(job) }.getOrDefault(emptyList())
            val saved = fetched.mapIndexedNotNull { i, sub ->
                val name = "addon-$i-${sub.lang}.${sub.ext}"
                runCatching { File(dir, name).writeText(sub.text, Charsets.UTF_8) }.getOrNull()?.let { Sidecar(url = "addon:$i", lang = sub.lang, file = name, label = sub.provider) }
            }
            job = job.copy(subtitles = job.subtitles + saved, addonSubtitlesDone = true)
        }
        store.write(job)
        listener.on(job)
        return job
    }
}
