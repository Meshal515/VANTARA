package com.vantara.anime

import com.vantara.anime.player.IntroSkip
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IntroSkipTest {
    private val body = """{"found":true,"results":[{"skipType":"ed","interval":{"startTime":1300,"endTime":1380},"episodeLength":1440},{"skipType":"op","interval":{"startTime":90,"endTime":180},"episodeLength":1440}]}"""

    @Test fun `only offers the opening within the actual episode duration`() {
        val op = IntroSkip.parse(body, 1_440_000)
        assertEquals(IntroSkip.Interval(90_000, 180_000), op)
        assertFalse(IntroSkip.visible(op, 89_999))
        assertTrue(IntroSkip.visible(op, 90_000))
        assertFalse(IntroSkip.visible(op, 179_000))
    }

    @Test fun `different cut or missing timing never skips guessed footage`() {
        assertNull(IntroSkip.parse(body, 1_200_000))
        assertNull(IntroSkip.parse("""{"found":false,"results":[]}""", 1_440_000))
        assertNull(IntroSkip.parse("""{"found":true,"results":[{"skipType":"op","interval":{"startTime":0,"endTime":1500}}]}""", 1_440_000))
    }
    @Test fun `ending timing keeps post credit scenes available`() {
        val timings = IntroSkip.parseTimings(body, 1_440_000)
        assertEquals(IntroSkip.Interval(90_000, 180_000), timings.opening)
        assertEquals(IntroSkip.Interval(1_300_000, 1_380_000), timings.ending)
        assertFalse(IntroSkip.visible(timings.ending, 1_299_999))
        assertTrue(IntroSkip.visible(timings.ending, 1_300_000))
        assertFalse(IntroSkip.visible(timings.ending, 1_379_000))
        assertTrue(timings.ending!!.endMs < 1_440_000)
    }

    @Test fun `timings require a known matching cut and a valid location`() {
        val unknownLength = """{"found":true,"results":[{"skipType":"ed","interval":{"startTime":1300,"endTime":1380}}]}"""
        assertNull(IntroSkip.parseTimings(unknownLength, 1_440_000).ending)
        assertNull(IntroSkip.parseTimings(body, 1_200_000).ending)
        val misplaced = body.replace("1300", "100").replace("1380", "180")
        assertNull(IntroSkip.parseTimings(misplaced, 1_440_000).ending)
    }

    @Test fun `mixed opening and ending are supported without guessing`() {
        val mixed = body.replace("\"op\"", "\"mixed-op\"").replace("\"ed\"", "\"mixed-ed\"")
        val timings = IntroSkip.parseTimings(mixed, 1_440_000)
        assertEquals(IntroSkip.Interval(90_000, 180_000), timings.opening)
        assertEquals(IntroSkip.Interval(1_300_000, 1_380_000), timings.ending)
        assertNull(IntroSkip.parseTimings("not json", 1_440_000).opening)
        assertNull(IntroSkip.parseTimings(body, 0).ending)
    }

    @Test fun `the active segment switches labels and disappears after a seek`() {
        val timings = IntroSkip.parseTimings(body, 1_440_000)
        assertTrue(IntroSkip.active(timings, 100_000)!!.opening)
        assertFalse(IntroSkip.active(timings, 1_310_000)!!.opening)
        assertNull(IntroSkip.active(timings, 1_380_000))
        assertNull(IntroSkip.active(timings, 500_000))
    }

    @Test fun `malformed response fields never throw or produce guessed timings`() {
        assertEquals(IntroSkip.Timings(), IntroSkip.parseTimings("""{"found":{},"results":[]} """, 1_440_000))
        assertEquals(IntroSkip.Timings(), IntroSkip.parseTimings("""{"found":true,"results":[null,{}, {"skipType":"ed","episodeLength":{},"interval":{}}]}""", 1_440_000))
    }

    @Test fun `fetch uses the timing API that supports mixed segments and camel case fields`() {
        val requests = mutableListOf<okhttp3.Request>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            requests += request
            val supported = request.url.encodedPath == "/v2/skip-times/16498/1"
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(if (supported) 200 else 400).message("fixture")
                .body(if (supported) body.toResponseBody() else "Bad Request".toResponseBody()).build()
        }.build()
        val timings = IntroSkip.fetchTimings(client, 16498, 1, 1_440_000)
        assertEquals(IntroSkip.Interval(90_000, 180_000), timings.opening)
        assertEquals(IntroSkip.Interval(1_300_000, 1_380_000), timings.ending)
        assertEquals(1, requests.size)
        assertEquals(setOf("op", "ed", "mixed-op", "mixed-ed"), requests.single().url.queryParameterValues("types[]").toSet())
        assertEquals("1440.0", requests.single().url.queryParameter("episodeLength"))
    }

    @Test fun `missing identifiers and failed service calls leave playback without guessed skips`() {
        var calls = 0
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            calls++
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(503).message("unavailable").body("".toResponseBody()).build()
        }.build()
        assertEquals(IntroSkip.Timings(), IntroSkip.fetchTimings(client, 0, 1, 1_440_000))
        assertEquals(IntroSkip.Timings(), IntroSkip.fetchTimings(client, 16498, 0, 1_440_000))
        assertEquals(0, calls)
        assertEquals(IntroSkip.Timings(), IntroSkip.fetchTimings(client, 16498, 1, 1_440_000))
        assertEquals(1, calls)
    }

    @Test fun `small video cut differences align the intervals instead of hiding both skips`() {
        val timings = IntroSkip.parseTimings(body, 1_420_000)
        assertEquals(IntroSkip.Interval(70_000, 160_000), timings.opening)
        assertEquals(IntroSkip.Interval(1_280_000, 1_360_000), timings.ending)
        assertNull(IntroSkip.parseTimings(body, 1_200_000).opening)
    }

    @Test fun `closest video cut wins even when an older response comes first`() {
        val response = """{"found":true,"results":[
            {"skipType":"op","episodeLength":1450,"interval":{"startTime":20,"endTime":100}},
            {"skipType":"op","episodeLength":1440,"interval":{"startTime":90,"endTime":180}}]}"""
        assertEquals(IntroSkip.Interval(90_000, 180_000), IntroSkip.parseTimings(response, 1_440_000).opening)
    }

    @Test fun `legacy provider field names are accepted without losing duration validation`() {
        val legacy = """{"found":true,"results":[{"skip_type":"op","episode_length":1440,"interval":{"start_time":90,"end_time":180}}]}"""
        assertEquals(IntroSkip.Interval(90_000, 180_000), IntroSkip.parseTimings(legacy, 1_440_000).opening)
        assertNull(IntroSkip.parseTimings(legacy, 1_200_000).opening)
    }

    @Test fun `short opening duration differences never shift past surrounding footage`() {
        val clipped = """{"found":true,"results":[{"skipType":"op","episodeLength":1450,"interval":{"startTime":1,"endTime":91}}]}"""
        val op = IntroSkip.parseTimings(clipped, 1_440_000).opening
        assertEquals(IntroSkip.Interval(0, 81_000), op)
        assertNull(IntroSkip.parseTimings(clipped, 30_000).opening)
    }
}
