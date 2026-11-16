package com.vantara.downloads

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** HL1: AES-128 بلا IV في HLS يعني IV = رقم تسلسل المقطع (RFC 8216 §5.2)، فالقائمة المحلية يجب أن تحفظه. */
class HlsLocalPlaylistTest {
    private val remote = """
        #EXTM3U
        #EXT-X-VERSION:3
        #EXT-X-TARGETDURATION:10
        #EXT-X-MEDIA-SEQUENCE:1532
        #EXT-X-KEY:METHOD=AES-128,URI="key.bin"
        #EXTINF:10.0,
        a.ts
        #EXTINF:10.0,
        b.ts
        #EXT-X-DISCONTINUITY
        #EXTINF:10.0,
        c.ts
        #EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x000000000000000000000000000000AB
        #EXTINF:10.0,
        d.ts
        #EXT-X-ENDLIST
    """.trimIndent()

    private fun local(): String {
        val media = HlsPlaylist.parseMedia(remote, "https://cdn/x/index.m3u8")
        return HlsPlaylist.localMedia(media, { "s$it.seg" }, { "key0" }, { "map" })
    }

    /** IV الفعلي الذي يستعمله المشغّل لكل مقطع في القائمة المحلية (صريح، أو تسلسله الضمني). */
    private fun effectiveIvs(text: String): List<String> {
        var seq = 0L; var iv: String? = null; val out = mutableListOf<String>()
        for (line in text.lines()) {
            when {
                line.startsWith("#EXT-X-MEDIA-SEQUENCE:") -> seq = line.substringAfter(':').toLong()
                line.startsWith("#EXT-X-KEY:") -> iv = HlsPlaylist.attributes(line)["IV"]
                line.isNotBlank() && !line.startsWith("#") -> { out += (iv ?: "0x%032X".format(seq)).uppercase().removePrefix("0X"); seq++ }
            }
        }
        return out
    }

    @Test fun implicitIvSurvivesLocalCopy() {
        val ivs = effectiveIvs(local())
        assertEquals("%032X".format(1532L), ivs[0])
        assertEquals("%032X".format(1533L), ivs[1])
        assertEquals("%032X".format(1534L), ivs[2])
        assertEquals("000000000000000000000000000000AB", ivs[3])
    }

    @Test fun discontinuityIsKept() {
        val text = local()
        val between = text.substringAfter("s1.seg").substringBefore("s2.seg")
        assertTrue(text, between.lines().contains("#EXT-X-DISCONTINUITY"))
        assertTrue(text, !text.substringBefore("s1.seg").contains("#EXT-X-DISCONTINUITY"))
    }
}
