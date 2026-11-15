package com.vantara.anime.stream

import com.vantara.addons.torrent.TorrentRequest
import java.net.URLDecoder

/**
 * روابط magnet من إضافات Aniyomi (Torrentio Anime وأمثالها بلا خدمة debrid). Aniyomi يشغّلها بخادم تورنت مدمج،
 * وفانتارا يمررها لمحرك التورنت نفسه الذي يشغّل تورنت Stremio، بواجهته العامة فقط.
 * صيغة Aniyomi: `magnet:?xt=urn:btih:<hash>&dn=…&tr=…&index=<fileIdx>` و`index=null` = الملف الأكبر.
 */
object MagnetLinks {
    const val TICKET_SCHEME = "vantara-torrent:"

    fun isMagnet(url: String): Boolean = url.startsWith("magnet:?", ignoreCase = true)

    fun request(magnet: String): TorrentRequest? = runCatching {
        if (!isMagnet(magnet) || magnet.length > 16384) return null
        val params = magnet.substringAfter('?').split('&').mapNotNull { part ->
            val pair = part.split('=', limit = 2)
            if (pair.size != 2) null else pair[0].lowercase() to URLDecoder.decode(pair[1], "UTF-8")
        }
        val hashes = params.filter { it.first == "xt" && it.second.startsWith("urn:btih:", ignoreCase = true) }
        if (hashes.size != 1) return null
        val index = params.firstOrNull { it.first == "index" }?.second?.toIntOrNull()?.takeIf { it >= 0 }
        TorrentRequest(hashes.single().second.substring(9), index, emptyList(), magnet)
    }.getOrNull()
}
