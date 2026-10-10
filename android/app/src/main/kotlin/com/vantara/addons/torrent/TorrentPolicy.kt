package com.vantara.addons.torrent

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.net.InetAddress
import java.io.ByteArrayOutputStream
import java.util.Locale

/** The same torrent and exact file selected by the addon, never a title-only lookup. */
class TorrentRequest(infoHash: String, val fileIdx: Int? = null, sources: List<String> = emptyList(), magnet: String? = null) {
    val infoHash = canonicalHash(infoHash)
    val trackers: List<String>
    init {
        require(this.infoHash.matches(Regex("[0-9a-f]{40}"))) { "Invalid torrent hash" }
        require(fileIdx == null || fileIdx >= 0) { "Invalid torrent file index" }
        val fields = if (magnet == null) emptyList() else {
            require(magnet.length <= 16384 && magnet.startsWith("magnet:?")) { "Invalid magnet" }
            magnet.substringAfter('?').split('&').map { part ->
                val pair = part.split('=', limit = 2)
                pair[0] to URLDecoder.decode(pair.getOrElse(1) { "" }, "UTF-8")
            }
        }
        if (magnet != null) {
            val hashes = fields.filter { it.first == "xt" }.map {
                require(it.second.startsWith("urn:btih:", true)) { "Unsupported magnet identity" }
                canonicalHash(it.second.substring(9))
            }
            require(hashes.size == 1 && hashes.single() == this.infoHash) { "Magnet identity does not match stream" }
        }
        trackers = (sources.take(100).filter { it.startsWith("tracker:") }.map { it.removePrefix("tracker:") } + fields.filter { it.first == "tr" }.map { it.second })
            .filter(::publicTracker).distinct().take(32)
    }
    fun magnetUri(): String = "magnet:?xt=urn:btih:$infoHash" + trackers.joinToString("") { "&tr=" + URLEncoder.encode(it, "UTF-8") }
    private fun publicTracker(value: String): Boolean = runCatching {
        val uri = URI(value)
        val host = uri.host?.lowercase(Locale.ROOT)?.removeSurrounding("[", "]") ?: return false
        value.length <= 2048 && uri.scheme in listOf("udp", "https", "http") && uri.userInfo == null &&
            (host.contains('.') || host.contains(':')) && !host.endsWith(".local") && !host.endsWith(".localhost") &&
            host != "localhost" && publicLiteralOrDomain(host)
    }.getOrDefault(false)
    private fun publicLiteralOrDomain(host: String): Boolean {
        if (!host.contains(':') && !Regex("^[0-9.]+$").matches(host)) return true
        // This branch contains numeric literals only: never resolve addon DNS on the UI thread.
        val address = InetAddress.getByName(host)
        if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return false
        val bytes = address.address
        if (bytes.size == 16 && ((bytes[0].toInt() and 254) == 252)) return false
        if (bytes.size == 4) {
            val first = bytes[0].toInt() and 255; val second = bytes[1].toInt() and 255
            if (first == 0 || first >= 224 || (first == 100 && second in 64..127)) return false
        }
        return true
    }
    companion object {
        private fun canonicalHash(raw: String): String {
            val hash = raw.lowercase(Locale.ROOT)
            if (hash.matches(Regex("[0-9a-f]{40}"))) return hash
            require(raw.uppercase(Locale.ROOT).matches(Regex("[A-Z2-7]{32}"))) { "Invalid torrent hash" }
            val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
            val out = ByteArrayOutputStream(20)
            var buffer = 0; var bits = 0
            for (char in raw.uppercase(Locale.ROOT)) {
                buffer = (buffer shl 5) or alphabet.indexOf(char); bits += 5
                if (bits >= 8) { bits -= 8; out.write((buffer ushr bits) and 255) }
            }
            return out.toByteArray().joinToString("") { "%02x".format(it) }
        }
    }
}

data class TorrentFile(val index: Int, val path: String, val size: Long, val offset: Long)
/**
 * فحص حي لسرب قبل التشغيل: هل وصلت بيانات التورنت من المشاركين، وكم مشاركًا اتصل فعلًا.
 * لا يُحمَّل شيء من الفيديو (يتوقف التورنت عند جاهزية البيانات).
 */
data class TorrentProbe(val metadata: Boolean, val peers: Int, val seeds: Int, val ms: Long) {
    /** alive: بيانات + مشارك · slow: مشاركون بلا بيانات بعد · dead: لا أحد خلال المهلة. */
    val verdict: String get() = when {
        metadata && peers > 0 -> "alive"
        metadata -> "slow"
        peers > 0 -> "slow"
        else -> "dead"
    }
}

data class TorrentStats(
    val peers: Int, val seeds: Int, val downloadBytesPerSecond: Long, val totalDone: Long, val metadata: Boolean,
    val state: String? = null, val paused: Boolean = false, val candidates: Int = 0, val known: Int = 0,
)
data class PieceRead(val piece: Int, val offset: Int, val length: Int)

/** Pure bounds/selection rules, shared by native loader and regression tests. */
object TorrentPolicy {
    private val video = Regex("(?i).*\\.(mkv|mp4|webm|avi|mov|m4v|ts)$")
    private fun playable(file: TorrentFile) = file.size > 0 && file.offset >= 0 && video.matches(file.path) &&
        !file.path.startsWith('/') && !file.path.contains('\\') && !file.path.contains('\u0000') &&
        file.path.split('/').none { it == ".." || it == "." } && !Regex("^[A-Za-z]:").containsMatchIn(file.path)
    fun selectFile(files: List<TorrentFile>, requested: Int?): TorrentFile =
        (if (requested == null) files.filter(::playable).maxByOrNull { it.size } else files.firstOrNull { it.index == requested && playable(it) })
            ?: throw IllegalArgumentException("No playable file at requested torrent index")
    fun readAt(file: TorrentFile, position: Long, pieceLength: Int, count: Int): PieceRead? {
        require(pieceLength > 0 && count >= 0 && position in 0..file.size)
        if (position == file.size || count == 0) return null
        val absolute = Math.addExact(file.offset, position)
        val piece = absolute / pieceLength
        require(piece <= Int.MAX_VALUE)
        val offset = (absolute % pieceLength).toInt()
        return PieceRead(piece.toInt(), offset, minOf(count.toLong(), file.size - position, (pieceLength - offset).toLong()).toInt())
    }
    /** First piece and the last two of the file: MP4 moov, MKV cues and AVI idx1 live at one end. */
    fun edges(file: TorrentFile, pieceLength: Int): List<Int> {
        if (file.size <= 0) return emptyList()
        val first = (file.offset / pieceLength).toInt()
        val last = ((Math.addExact(file.offset, file.size) - 1) / pieceLength).toInt()
        return listOf(first, last - 1, last).filter { it in first..last }.distinct()
    }
    fun window(file: TorrentFile, position: Long, pieceLength: Int, count: Int = 12): List<Int> {
        require(count in 1..64)
        val first = readAt(file, position, pieceLength, 1)?.piece ?: return emptyList()
        val last = ((Math.addExact(file.offset, file.size) - 1) / pieceLength).toInt()
        return (first..minOf(last, first + count - 1)).toList()
    }
}
