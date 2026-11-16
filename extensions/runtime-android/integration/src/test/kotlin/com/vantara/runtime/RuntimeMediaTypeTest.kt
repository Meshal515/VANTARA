package com.vantara.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

class RuntimeMediaTypeTest {
    @Test fun declaredTypesAreKept() {
        assertEquals("hls",mediaType("M3U8","https://cdn.example/v.mp4"))
        assertEquals("dash",mediaType("DASH","https://cdn.example/v"))
        assertEquals("direct",mediaType("VIDEO","https://cdn.example/master.m3u8"))
    }
    @Test fun inferredLinksAreTypedByTheirUrl() {
        assertEquals("hls",mediaType("INFERRED","https://cdn.example/hls/master.m3u8?token=1"))
        assertEquals("hls",mediaType("INFERRED","https://cdn.example/index.m3u8/seg"))
        assertEquals("dash",mediaType("INFERRED","https://cdn.example/manifest.mpd"))
        assertEquals("direct",mediaType("INFERRED","https://cdn.example/episode.mp4"))
    }
}
