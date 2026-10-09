package com.vantara.addons

import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.StreamClassifier
import kotlinx.serialization.json.*
import java.security.MessageDigest

/** Bounded protocol boundary: one malformed result never discards valid siblings. */
object NativeAddonCandidates {
    private fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    private fun JsonObject.number(key: String) = (get(key) as? JsonPrimitive)?.longOrNull
    private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).take(12).joinToString("") { "%02x".format(it) }
    private fun requestHeaders(value: JsonElement?): Map<String, String> {
        if (value == null || value == JsonNull) return emptyMap()
        val obj = value as? JsonObject ?: error("Invalid stream headers")
        require(obj.size <= 32)
        return obj.mapValues { (key, raw) ->
            val content = (raw as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull ?: error("Invalid stream header")
            require(Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}").matches(key) && key.lowercase() !in setOf("host", "content-length", "connection", "transfer-encoding", "proxy-authorization", "proxy-connection"))
            require(content.length <= 8192 && content.none { it.code < 32 || it.code == 127 })
            content
        }
    }
    fun displayName(value: String) = value.trim().takeIf { it.length in 1..100 && !it.contains(Regex("https?://|manifest\\.json", RegexOption.IGNORE_CASE)) } ?: "إضافة"

    fun torrentRequest(stream: JsonObject): com.vantara.addons.torrent.TorrentRequest {
        val magnet = stream.text("magnet") ?: stream.text("url")?.takeIf { it.startsWith("magnet:") }
        val hash = stream.text("infoHash") ?: magnet?.let { value ->
            Regex("urn:btih:([a-fA-F0-9]{40})").find(java.net.URLDecoder.decode(value, "UTF-8"))?.groupValues?.get(1)
        }.orEmpty()
        val indexValue = stream["fileIdx"]
        val index = if (indexValue == null || indexValue == JsonNull) null else {
            require(indexValue is JsonPrimitive && !indexValue.isString)
            indexValue.intOrNull?.takeIf { it >= 0 } ?: error("Invalid torrent file index")
        }
        val sources = (stream["sources"] as? JsonArray)?.take(100)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull }.orEmpty()
        return com.vantara.addons.torrent.TorrentRequest(hash, index, sources, magnet)
    }

    fun parse(session: String, sourceId: String, name: String, raw: JsonElement, now: Long,
              torrent: ((JsonObject) -> String?)? = null): List<Candidate> {
        if (!sourceId.startsWith("addon|") || sourceId.length > 4096) return emptyList()
        val sourceName = displayName(name)
        val entries = (raw as? JsonArray)?.take(1000) ?: return emptyList()
        return entries.distinct().mapIndexedNotNull { index, element -> runCatching {
            val s = element as? JsonObject ?: return@runCatching null
            if (s.text("status")?.let { it !in setOf("READY", "RESOLVED") } == true) return@runCatching null
            val expiry = s.number("expiresAt") ?: (now + StreamClassifier.DEFAULT_TTL_MS)
            if (expiry <= now) return@runCatching null
            val isTorrent = s.text("type") == "torrent" || s.text("infoHash") != null || s.text("url")?.startsWith("magnet:") == true
            val httpUrl = if (isTorrent) null else RemoteAddonClient.publicUrl(s.text("url") ?: return@runCatching null).toString()
            val hints = s["behaviorHints"] as? JsonObject
            val proxy = hints?.get("proxyHeaders") as? JsonObject
            val response = proxy?.get("response")
            if (response != null && response != JsonNull && (response !is JsonObject || response.keys.any { !it.startsWith("access-control-", true) })) return@runCatching null
            val headers = requestHeaders(s["headers"]) + requestHeaders(proxy?.get("request"))
            val subtitles = (s["subtitles"] as? JsonArray)?.take(100)?.mapNotNull { t -> runCatching {
                val track = t.jsonObject
                com.vantara.anime.stream.TrackRef(RemoteAddonClient.publicUrl(track.text("url") ?: error("url")).toString(), track.text("lang")?.take(32) ?: "und")
            }.getOrNull() }.orEmpty()
            val url = if (isTorrent) torrent?.invoke(s) ?: return@runCatching null else requireNotNull(httpUrl)
            val id = "$session|addon|${digest(sourceId)}|${digest(s.text("id") ?: "$index|$url") }"
            Candidate(
                id = id, sourceId = sourceId, sourceName = sourceName,
                server = sourceName, host = if (isTorrent) "torrent" else StreamClassifier.host(url), url = url,
                headers = headers, quality = s.number("quality")?.takeIf { it in 144..8640 }?.toInt() ?: StreamClassifier.quality(s.text("name"), s.text("title")) ?: if (Regex("\\b4k\\b", RegexOption.IGNORE_CASE).containsMatchIn(s.text("name").orEmpty() + " " + s.text("title").orEmpty())) 2160 else null,
                label = s.text("title")?.take(500) ?: s.text("name")?.take(500).orEmpty(),
                variant = StreamClassifier.variant(s.text("name"), s.text("title")),
                container = when(s.text("type")) { "hls" -> Container.HLS; "dash" -> Container.DASH; "mp4" -> Container.MP4; else -> StreamClassifier.container(url) },
                subtitles = subtitles, resolvedAt = now, expiresAt = expiry,
                filename = (s.text("filename") ?: hints?.text("filename"))?.take(1000), videoHash = (s.text("videoHash") ?: hints?.text("videoHash"))?.takeIf { Regex("[a-fA-F0-9]{16}").matches(it) },
                videoSize = (s.number("videoSize") ?: hints?.number("videoSize"))?.takeIf { it > 0 }, duration = s.number("duration")?.takeIf { it > 0 },
                fps = (s["fps"] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() && it > 0 },
            )
        }.getOrNull() }.distinctBy { it.id }
    }
}
