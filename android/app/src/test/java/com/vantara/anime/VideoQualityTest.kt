package com.vantara.anime

import com.vantara.anime.player.RouteGroups
import com.vantara.anime.stream.Route
import com.vantara.anime.stream.RouteState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VideoQualityTest {
    @Test fun `all extracted quality heights retain their actual value`() {
        val heights = listOf(144, 240, 360, 480, 720, 1080, 1440, 2160)
        assertEquals(heights, heights.map(RouteGroups::bucket))
    }

    @Test fun `nonstandard heights are not relabelled as an unavailable quality`() {
        val heights = listOf(576, 800, 1024, 1448)
        assertEquals(heights, heights.map(RouteGroups::bucket))
    }

    @Test fun `unknown and invalid heights do not become a selectable resolution`() {
        assertNull(RouteGroups.bucket(null))
        assertNull(RouteGroups.bucket(-1))
        assertNull(RouteGroups.bucket(0))
    }

    @Test fun `server sheet keeps every actual quality in descending order`() {
        val heights = listOf(144, 240, 360, 480, 720, 1080, 1440, 2160)
        val routes = heights.map { route("q$it", it) } +
            listOf(route("unknown", null), route("dead", 1080, RouteState.UNAVAILABLE))

        val groups = RouteGroups.group(routes)

        assertEquals(heights.reversed().map { "${it}p" } + listOf("جودة غير محددة", "غير متاح"), groups.map { it.first })
        assertEquals(routes.map { it.id }.toSet(), groups.flatMap { it.second }.map { it.id }.toSet())
    }

    private fun route(id: String, quality: Int?, state: RouteState = RouteState.READY) = Route(
        id = id, sourceId = "source", server = "ok.ru", code = "OKR", quality = quality, state = state,
    )
}
