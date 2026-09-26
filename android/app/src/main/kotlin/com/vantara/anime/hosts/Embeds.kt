package com.vantara.anime.hosts

import com.vantara.anime.stream.Container
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.await
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.OkHttpClient
import org.jsoup.Jsoup

/**
 * سيرفرات الفيديو المضمّنة: من رابط صفحة المشغّل (`ok.ru/videoembed/…`) إلى
 * رابط فيديو يشغّله Media3 مباشرة. محوّلاتنا الأصلية لا تعتمد على مستخرجات
 * الإضافات.
 */
data class Stream(
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val quality: Int? = null,
    val label: String = "",
    /** صيغة معروفة سلفًا حين لا يدل عليها الرابط (Google Drive: `/download?id=…`). */
    val container: Container? = null,
)

/** يفتح صفحة المشغّل كمتصفح مخفي ويلتقط أول طلب فيديو (m3u8/mp4/mpd). */
fun interface Sniffer {
    suspend fun sniff(url: String, referer: String?): Stream?
}

/**
 * الترتيب لكل سيرفر:
 *  1. معالج خاص: ok.ru، Google Drive، megamax (بوابة لمرايا)، vk.
 *  2. الاستخراج العام من الصفحة ([Generic]): يكفي أغلب المضيفات بلا متصفح.
 *  3. المتصفح المخفي ([Sniffer]) آخر حل فقط: بطيء وثقيل على الجوال.
 * ترويسات الفيديو: Referer وOrigin صفحة المشغّل نفسها، وUser-Agent العميل.
 */
class EmbedResolver(
    private val client: OkHttpClient,
    private val sniffer: Sniffer? = null,
    private val userAgent: () -> String? = { null },
) {
    suspend fun resolve(embed: String, referer: String?): List<Stream> = resolve(embed, referer, depth = 0)

    private suspend fun resolve(embed: String, referer: String?, depth: Int): List<Stream> {
        val url = if (embed.startsWith("//")) "https:$embed" else embed
        val host = url.toHttpUrlOrNull()?.host?.lowercase() ?: return emptyList()
        return when {
            host.endsWith("ok.ru") || host.endsWith("odnoklassniki.ru") -> OkRu.parse(fetch(url, referer).body)
            // الفيديو مشفّر ويُفك داخل صفحة MEGA نفسها: لا رابط يلتقطه أحد
            host.endsWith("mega.nz") || host.endsWith("mega.co.nz") -> emptyList()
            host.endsWith("drive.google.com") || host.endsWith("docs.google.com") ->
                listOfNotNull(GoogleDrive.stream(url, userAgent()))
            (host.endsWith("share4max.com") || host.contains("megamax")) && depth == 0 -> megamax(url, referer)
            host.endsWith("videa.hu") -> videa(url, referer).ifEmpty { sniff(url, referer) }
            host.contains("yonaplay") && depth == 0 -> yonaplay(url, referer)
            host.endsWith("vk.com") || host.endsWith("vkvideo.ru") || host.endsWith("vk.ru") ->
                runCatching { fetch(url, referer) }.getOrNull()?.let { Vk.parse(it.body, headersFor(it.url)) }.orEmpty()
                    .ifEmpty { sniff(url, referer) }
            else -> generic(url, referer)
        }
    }

    private suspend fun generic(url: String, referer: String?): List<Stream> {
        val page = runCatching { fetch(url, referer) }.getOrNull()
        if (page != null && page.ok) {
            val found = Generic.streams(page.body, page.url)
            if (found.isNotEmpty()) {
                val headers = headersFor(page.url)
                return found.take(3).map { Stream(it, headers, null, host(page.url)) }
            }
        }
        // تحدٍّ (403) أو مشغّل يبني الرابط بسكربت: المتصفح المخفي آخر حل
        return sniff(url, referer)
    }

    private suspend fun videa(url: String, referer: String?): List<Stream> {
        val page = fetch(url, referer)
        val token = Videa.token(page.body) ?: return emptyList()
        val seed = (1..8).map { "abcdefghijklmnopqrstuvwxyz0123456789".random() }.joinToString("")
        val q = page.url.toHttpUrlOrNull()?.queryParameter("v") ?: url.toHttpUrlOrNull()?.queryParameter("v") ?: return emptyList()
        val xmlUrl = "https://videa.hu/player/xml?v=$q&_s=$seed&_t=${token.take(16)}"
        val headers = Headers.Builder().add("Referer", page.url).apply { userAgent()?.let { add("User-Agent", it) } }.build()
        val xml = client.newCall(GET(xmlUrl, headers)).await().use { r ->
            val body = r.body.string()
            if (body.trimStart().startsWith("<?xml")) body
            else {
                val xs = r.header("x-videa-xs") ?: return emptyList()
                String(Videa.rc4(java.util.Base64.getMimeDecoder().decode(body.trim()), token.substring(16) + seed + xs), Charsets.UTF_8)
            }
        }
        return Videa.toStreams(Videa.sources(xml), page.url, userAgent())
    }

    /** yonaplay يغلّف سيرفرات أخرى: نفك قائمته ونحل كل سيرفر فيها (عدا Mega). */
    private suspend fun yonaplay(url: String, referer: String?): List<Stream> {
        val page = fetch(url, referer)
        val origin = page.url.toHttpUrlOrNull()?.let { "${it.scheme}://${it.host}" } ?: return emptyList()
        suspend fun post(path: String, body: String): String {
            val req = okhttp3.Request.Builder().url("$origin/api/$path")
                .post(body.toRequestBody("application/json".toMediaType()))
                .header("X-Requested-With", "XMLHttpRequest")
                .header("Accept", "application/json")
                .header("Referer", page.url)
                .header("Origin", origin)
                .apply { userAgent()?.let { header("User-Agent", it) } }
                .build()
            return client.newCall(req).await().use { it.body.string() }
        }
        val session = Yonaplay.session(post("init-session.php", "{}")) ?: return emptyList()
        val servers = Yonaplay.servers(post("sources.php", """{"code":${quote(session.code)}}"""))
        val out = mutableListOf<Stream>()
        for (s in servers) {
            if (s.name.contains("mega", ignoreCase = true)) continue
            val body = """{"code":${quote(session.code)},"token":${quote(s.token)},"key":${quote(session.key)}}"""
            val target = Yonaplay.payload(post("api.php", body))?.let { Yonaplay.decrypt(it, session.key) } ?: continue
            if (target.contains("mega.nz")) continue
            val got = runCatching { resolve(target, page.url, depth = 1) }.getOrDefault(emptyList())
            out += got.map { it.copy(quality = it.quality ?: s.quality, label = "yonaplay/${s.name.lowercase()}") }
            if (out.size >= 2) break
        }
        return out
    }

    private fun quote(s: String) = kotlinx.serialization.json.JsonPrimitive(s).toString()

    private suspend fun sniff(url: String, referer: String?): List<Stream> =
        sniffer?.sniff(url, referer)?.let(::listOf).orEmpty()

    /** megamax: صفحة Inertia تحمل «مرايا» كل جودة على مضيفات أخرى؛ نجرّبها بالترتيب. */
    private suspend fun megamax(url: String, referer: String?): List<Stream> {
        val first = fetch(url, referer)
        val version = Megamax.version(first.body) ?: return emptyList()
        val headers = Headers.Builder().apply {
            add("X-Inertia", "true")
            add("X-Inertia-Version", version)
            add("X-Inertia-Partial-Component", "files/mirror/video")
            add("X-Inertia-Partial-Data", "streams")
            add("X-Requested-With", "XMLHttpRequest")
            add("Accept", "text/html, application/xhtml+xml")
            add("Referer", first.url)
        }.build()
        val body = client.newCall(GET(first.url, headers)).await().use { it.body.string() }
        val out = mutableListOf<Stream>()
        for (m in Megamax.mirrors(body).take(MEGAMAX_TRIES)) {
            val got = runCatching { resolve(m.link, first.url, depth = 1) }.getOrDefault(emptyList())
            out += got.map { it.copy(quality = it.quality ?: m.quality, label = "megamax/${m.driver}") }
            if (out.size >= 2) break
        }
        return out
    }

    private fun headersFor(pageUrl: String): Map<String, String> {
        val origin = pageUrl.toHttpUrlOrNull()?.let { "${it.scheme}://${it.host}" } ?: return emptyMap()
        return buildMap {
            put("Referer", "$origin/")
            put("Origin", origin)
            userAgent()?.let { put("User-Agent", it) }
        }
    }

    private class Page(val url: String, val body: String, val ok: Boolean)

    private suspend fun fetch(url: String, referer: String?): Page {
        val headers = Headers.Builder().apply {
            referer?.let { add("Referer", it) }
            userAgent()?.let { add("User-Agent", it) }
        }.build()
        return client.newCall(GET(url, headers)).await().use { r -> Page(r.request.url.toString(), r.body.string(), r.isSuccessful) }
    }

    private fun host(url: String) = url.toHttpUrlOrNull()?.host?.removePrefix("www.").orEmpty()

    companion object {
        /** أسماء السيرفرات التي نعرف أنها لا تُشغَّل الآن (تُترك بلا محاولة). */
        val UNSUPPORTED = setOf("mega")
        private const val MEGAMAX_TRIES = 5
    }
}

internal object OkRu {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    private val QUALITY = mapOf(
        "mobile" to 144, "lowest" to 240, "low" to 360, "sd" to 480,
        "hd" to 720, "full" to 1080, "quad" to 1440, "ultra" to 2160,
    )

    /** `data-options` ← `flashvars.metadata` (نص JSON داخل JSON) ← روابط كل جودة. */
    fun parse(html: String): List<Stream> {
        val options = Jsoup.parse(html).selectFirst("[data-options]")?.attr("data-options") ?: return emptyList()
        val flashvars = runCatching { json.parseToJsonElement(options).jsonObject["flashvars"]?.jsonObject }.getOrNull() ?: return emptyList()
        val raw = flashvars["metadata"] ?: return emptyList()
        val meta = runCatching {
            if (raw is JsonObject) raw else json.parseToJsonElement(raw.jsonPrimitive.content).jsonObject
        }.getOrNull() ?: return emptyList()
        val headers = mapOf("Referer" to "https://ok.ru/", "Origin" to "https://ok.ru")
        val files = meta["videos"]?.jsonArray.orEmpty().mapNotNull { v ->
            val o = v.jsonObject
            val url = o["url"]?.jsonPrimitive?.content?.takeIf { it.startsWith("http") } ?: return@mapNotNull null
            val name = o["name"]?.jsonPrimitive?.content.orEmpty()
            Stream(url, headers, QUALITY[name], "ok.ru $name", Container.MP4)
        }
        val hls = meta["hlsManifestUrl"]?.jsonPrimitive?.content?.takeIf { it.startsWith("http") }
            ?.let { Stream(it, headers, null, "ok.ru auto", Container.HLS) }
        return listOfNotNull(hls) + files.sortedByDescending { it.quality ?: 0 }
    }
}

internal object FourShared {
    fun parse(html: String): List<Stream> =
        Generic.streams(html, "https://www.4shared.com/")
            .map { Stream(it, mapOf("Referer" to "https://www.4shared.com/"), null, "4shared") }
}

/**
 * Google Drive: صفحة المعاينة لا تعطي رابطًا، لكن رابط التنزيل المؤكَّد يعيد
 * `video/mp4` بدعم المدى (التقديم والتأخير). جُرّب على ملف حلقة حقيقي من WitAnime.
 */
internal object GoogleDrive {
    private val ID = Regex("""/file/d/([A-Za-z0-9_-]{10,})|[?&]id=([A-Za-z0-9_-]{10,})""")

    fun stream(url: String, userAgent: String?): Stream? {
        val m = ID.find(url) ?: return null
        val id = m.groupValues[1].ifEmpty { m.groupValues[2] }
        return Stream(
            "https://drive.usercontent.google.com/download?id=$id&export=download&confirm=t",
            buildMap { userAgent?.let { put("User-Agent", it) } },
            null,
            "google drive",
            Container.MP4,
        )
    }
}

/** megamax (share4max): Inertia بجودات، ولكل جودة مرايا على مضيفات أخرى. */
internal object Megamax {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    /** ترتيب المرايا: الأسهل استخراجًا والأثبت أولًا. */
    private val PREFERENCE = listOf("mp4upload", "earnvids", "lulustream", "streamhg", "streamwish", "mixdrop", "krakenfiles", "fileupload", "voe")

    data class Mirror(val driver: String, val link: String, val quality: Int?)

    fun version(html: String): String? = runCatching {
        val data = Jsoup.parse(html).selectFirst("script[data-page]")?.data() ?: return null
        json.parseToJsonElement(data).jsonObject["version"]?.jsonPrimitive?.contentOrNull
    }.getOrNull()

    fun mirrors(body: String): List<Mirror> = runCatching {
        val data = json.parseToJsonElement(body).jsonObject["props"]?.jsonObject?.get("streams")?.jsonObject?.get("data")?.jsonArray
            ?: return emptyList()
        data.flatMap { q ->
            val o = q.jsonObject
            val quality = o["label"]?.jsonPrimitive?.contentOrNull?.let { Regex("""(\d{3,4})p""").find(it)?.groupValues?.get(1)?.toIntOrNull() }
            o["mirrors"]?.jsonArray.orEmpty().mapNotNull { m ->
                val mo = m.jsonObject
                val link = mo["link"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                Mirror(mo["driver"]?.jsonPrimitive?.contentOrNull.orEmpty(), link, quality)
            }
        }.sortedWith(
            compareByDescending<Mirror> { it.quality ?: 0 }
                .thenBy { PREFERENCE.indexOf(it.driver).let { i -> if (i < 0) PREFERENCE.size else i } },
        )
    }.getOrDefault(emptyList())
}

/** vk: صفحة video_ext.php تحمل `"url720":"…"` و`"hls":"…"` حين تُفتح من جوال. */
internal object Vk {
    private val FIELD = Regex(""""(url(\d{3,4})|hls)"\s*:\s*"([^"]+)"""")

    fun parse(html: String, headers: Map<String, String>): List<Stream> =
        FIELD.findAll(html).mapNotNull { m ->
            val url = m.groupValues[3].replace("\\/", "/").takeIf { it.startsWith("http") } ?: return@mapNotNull null
            val q = m.groupValues[2].toIntOrNull()
            Stream(url, headers, q, "vk ${m.groupValues[1]}", if (q == null) Container.HLS else Container.MP4)
        }.distinctBy { it.url }.sortedByDescending { if (it.quality == null) Int.MAX_VALUE else it.quality }.toList()
}
