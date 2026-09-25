package com.vantara.anime.hosts

import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.awaitSuccess
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
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
)

/** يفتح صفحة المشغّل كمتصفح مخفي ويلتقط أول طلب فيديو (m3u8/mp4/mpd). */
fun interface Sniffer {
    suspend fun sniff(url: String, referer: String?): Stream?
}

class EmbedResolver(
    private val client: OkHttpClient,
    private val sniffer: Sniffer? = null,
) {
    suspend fun resolve(embed: String, referer: String?): List<Stream> {
        val host = embed.toHttpUrlOrNull()?.host ?: return emptyList()
        return when {
            host.endsWith("ok.ru") || host.endsWith("odnoklassniki.ru") -> OkRu.parse(fetch(embed, referer))
            host.endsWith("4shared.com") -> FourShared.parse(fetch(embed, referer))
            // الفيديو مشفّر ويُفك داخل صفحة MEGA نفسها: لا رابط يلتقطه المتصفح المخفي
            host.endsWith("mega.nz") || host.endsWith("mega.co.nz") -> emptyList()
            else -> sniffer?.sniff(embed, referer)?.let(::listOf).orEmpty()
        }
    }

    private suspend fun fetch(url: String, referer: String?): String {
        val headers = Headers.Builder().apply { referer?.let { add("Referer", it) } }.build()
        return client.newCall(GET(url, headers)).awaitSuccess().use { it.body.string() }
    }

    companion object {
        /** أسماء السيرفرات التي نعرف أنها لا تُشغَّل الآن (تُترك بلا محاولة). */
        val UNSUPPORTED = setOf("mega")
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
            Stream(url, headers, QUALITY[name], "ok.ru $name")
        }
        val hls = meta["hlsManifestUrl"]?.jsonPrimitive?.content?.takeIf { it.startsWith("http") }
            ?.let { Stream(it, headers, null, "ok.ru auto") }
        return listOfNotNull(hls) + files.sortedByDescending { it.quality ?: 0 }
    }
}

internal object FourShared {
    fun parse(html: String): List<Stream> =
        Jsoup.parse(html).select("video source[src], source[type^=video][src]")
            .map { it.attr("src") }
            .filter { it.startsWith("http") }
            .distinct()
            .map { Stream(it, mapOf("Referer" to "https://www.4shared.com/"), null, "4shared") }
}
