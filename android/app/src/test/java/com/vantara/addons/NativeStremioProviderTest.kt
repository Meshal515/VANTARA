package com.vantara.addons

import org.junit.Assert.*
import org.junit.Test

class NativeStremioProviderTest {
    private val provider = NativeStremioProvider("addon|torrentio", "Torrentio", "https://addon.test/options/manifest.json?key=private", "series", "tt4574334:2:3")
    @Test fun `next episode identity preserves canonical work and season without titles`() {
        assertEquals("tt4574334:2:4", provider.idAt(4f))
        assertNull(provider.idAt(4.5f))
        assertEquals("https://addon.test/options/stream/series/tt4574334%3A2%3A4.json?key=private", provider.endpoint(4f))
    }
    @Test fun `private catalog IDs use explicit episode mapping rather than IMDb guessing`() {
        val custom = provider.copy(videoId = "provider-private-current", season = 2,
            episodes = listOf(NativeAddonEpisode(4f, "wrong-season", 1), NativeAddonEpisode(4f, "provider-next", 2)))
        assertEquals("provider-next", custom.idAt(4f))
        assertNull(custom.idAt(5f))
        assertNull(provider.copy(videoId = "Stranger Things").idAt(4f))
    }
    @Test fun `provider identities are bounded and refuse unsafe manifest hosts`() {
        assertFalse(provider.copy(manifestUrl = "https://127.0.0.1/manifest.json").valid())
        assertFalse(provider.copy(type = "../series").valid())
        assertFalse(provider.copy(sourceId = "native-source").valid())
        assertFalse(provider.copy(episodes = List(10001) { NativeAddonEpisode(it.toFloat(), "$it") }).valid())
    }
    @Test fun `private opaque IDs preserve encoded space and plus exactly like Stremio adapter`() {
        val custom = provider.copy(videoId = "current-private", season = 2, episodes = listOf(NativeAddonEpisode(4f, "private:episode 4 + extra", 2)))
        assertTrue(custom.endpoint(4f)!!.contains("private%3Aepisode%204%20%2B%20extra.json"))
    }

    @Test fun `canonical Kitsu anime next episode never adds an invented season segment`() {
        val anime = provider.copy(videoId = "kitsu:1234:4", season = null)
        assertEquals("kitsu:1234:5", anime.idAt(5f))
        assertTrue(anime.endpoint(5f)!!.contains("/stream/series/kitsu%3A1234%3A5.json"))
        assertTrue(anime.copy(episodes = List(1200) { NativeAddonEpisode((it + 1).toFloat(), "kitsu:1234:${it + 1}") }).valid())
    }

}
