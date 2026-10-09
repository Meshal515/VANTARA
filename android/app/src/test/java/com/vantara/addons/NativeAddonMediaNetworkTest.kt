package com.vantara.addons

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test

class NativeAddonMediaNetworkTest {
    @Test fun `redirected CDN cannot inherit addon auth cookie or arbitrary token headers`() {
        val request = Request.Builder().url("https://cdn.test/video.mp4").header("Authorization", "Bearer secret")
            .header("Cookie", "session=secret").header("X-Token", "secret").header("Referer", "https://source.test/").header("User-Agent", "VANTARA").build()
        val scoped = scopedAddonRequest(request, "https://video.test/file.mp4".toHttpUrl(), setOf("Authorization", "Cookie", "X-Token", "Referer", "User-Agent"))
        assertNull(scoped.header("Authorization")); assertNull(scoped.header("Cookie")); assertNull(scoped.header("X-Token"))
        assertEquals("https://source.test/", scoped.header("Referer")); assertEquals("VANTARA", scoped.header("User-Agent"))
    }
    @Test fun `same origin retains required explicit addon credentials but signed referer is scoped`() {
        val request = Request.Builder().url("https://video.test/segment.ts").header("X-Token", "secret").header("Referer", "https://source.test/?token=secret").build()
        assertSame(request, scopedAddonRequest(request, "https://video.test/file.m3u8".toHttpUrl(), setOf("X-Token", "Referer")))
        val foreign = request.newBuilder().url("https://cdn.test/segment.ts").build()
        assertNull(scopedAddonRequest(foreign, "https://video.test/file.m3u8".toHttpUrl(), setOf("X-Token", "Referer")).header("Referer"))
    }
    @Test fun `torrent cold metadata budget never alters normal source startup and stall limits`() {
        assertEquals(15000L, com.vantara.anime.player.PlaybackBudgets.startupMs("https://video.test/video.mp4"))
        assertEquals(20000L, com.vantara.anime.player.PlaybackBudgets.stalledMs("https://video.test/video.mp4"))
        assertEquals(90000L, com.vantara.anime.player.PlaybackBudgets.startupMs("vantara-torrent://ticket/file"))
        assertEquals(35000L, com.vantara.anime.player.PlaybackBudgets.stalledMs("vantara-torrent://ticket/file"))
    }
    @Test fun `torrent ticket has no HTTP origin so sidecar requests never receive torrent credentials`() {
        val request = Request.Builder().url("https://subtitle.test/ar.vtt").header("X-Token", "secret").build()
        assertNull(scopedAddonRequest(request, null, setOf("X-Token")).header("X-Token"))
    }

}
