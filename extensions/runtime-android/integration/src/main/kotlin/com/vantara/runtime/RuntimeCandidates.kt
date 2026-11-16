package com.vantara.runtime

import com.vantara.addons.NativeAddonCandidates
import com.vantara.addons.addonMediaUrl
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.StreamClassifier
import kotlinx.serialization.json.*
import java.security.MessageDigest

/**
 * CloudStream links → playback candidates. Same shape as the Stremio boundary (NativeAddonCandidates, left untouched)
 * except the link policy: a source engine's links follow the original engine (http and any port; never credentials or
 * private/local addresses, see addonMediaUrl). One malformed link never discards its siblings.
 */
internal object RuntimeCandidates {
    private fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    private fun JsonObject.number(key: String) = (get(key) as? JsonPrimitive)?.longOrNull
    private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).take(12).joinToString("") { "%02x".format(it) }
    private val headerName = Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}")
    // Transport headers belong to the player's own connection (Range: the player seeks with its own ranges).
    private val hopByHop = setOf("host", "content-length", "connection", "transfer-encoding", "proxy-authorization", "proxy-connection", "range")

    /**
     * Providers attach headers meant for their own player (AnimeRift: Host, Connection, Range for libmpv). The original
     * engine plays the link anyway, so an unusable or unsafe header is dropped, never the link: rejecting the whole link
     * made its 1080p servers vanish from the sheet (reference comparison). Injection stays impossible: names must be
     * tokens and values carry no control characters, or the header is not sent at all.
     */
    private fun headers(value: JsonElement?): Map<String, String> {
        val obj = value as? JsonObject ?: return emptyMap()
        return obj.entries.take(32).mapNotNull { (key, raw) ->
            val content = (raw as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull ?: return@mapNotNull null
            if (!headerName.matches(key) || key.lowercase() in hopByHop) return@mapNotNull null
            if (content.length > 8192 || content.any { it.code < 32 || it.code == 127 }) return@mapNotNull null
            key to content
        }.toMap()
    }

    fun parse(session: String, sourceId: String, name: String, raw: JsonArray, now: Long): List<Candidate> {
        val sourceName = NativeAddonCandidates.displayName(name)
        return raw.take(1000).distinct().mapIndexedNotNull { index, element -> runCatching {
            val s = element as? JsonObject ?: return@runCatching null
            val url = addonMediaUrl(s.text("url") ?: return@runCatching null, plain = true).toString()
            val label = s.text("title")?.take(500) ?: s.text("name")?.take(500).orEmpty()
            Candidate(
                id = "$session|addon|${digest(sourceId)}|${digest("$index|$url")}", sourceId = sourceId, sourceName = sourceName,
                server = sourceName, host = StreamClassifier.host(url), url = url, headers = headers(s["headers"]),
                quality = s.number("quality")?.takeIf { it in 144..8640 }?.toInt() ?: StreamClassifier.quality(s.text("name"), s.text("title")),
                label = label, variant = StreamClassifier.variant(s.text("name"), s.text("title")),
                container = when (s.text("type")) { "hls" -> Container.HLS; "dash" -> Container.DASH; "mp4" -> Container.MP4; else -> StreamClassifier.container(url) },
                resolvedAt = now, expiresAt = now + StreamClassifier.DEFAULT_TTL_MS,
            )
        }.getOrNull() }.distinctBy { it.id }
    }
}
