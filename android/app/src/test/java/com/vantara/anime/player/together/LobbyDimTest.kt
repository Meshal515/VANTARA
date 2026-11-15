package com.vantara.anime.player.together

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LobbyDimTest {
    private fun solid(w: Int, h: Int, argb: Int) = IntArray(w * h) { argb }

    @Test fun whiteLeftBannerGetsFullDimAndDarkOneNone() {
        // أركين: نصفه الأيسر أبيض ناصع ⇒ تعتيم كامل
        val white = LobbyDim.leftLuma(solid(32, 18, 0xFFFFFFFF.toInt()), 32, 18)
        assertEquals(1f, LobbyDim.strength(white), 0.001f)
        // بنر غامق ⇒ لا تعتيم (لا يُمسّ البنر الصافي)
        val dark = LobbyDim.leftLuma(solid(32, 18, 0xFF202028.toInt()), 32, 18)
        assertEquals(0f, LobbyDim.strength(dark), 0.001f)
    }

    @Test fun onlyTheLeftColumnsDecide() {
        // يسار غامق ويمين أبيض (الشعار والشخصيات في اليمين) ⇒ لا تعتيم
        val px = IntArray(32 * 18) { i -> if (i % 32 < 14) 0xFF101010.toInt() else 0xFFFFFFFF.toInt() }
        assertEquals(0f, LobbyDim.strength(LobbyDim.leftLuma(px, 32, 18)), 0.001f)
    }

    @Test fun midLuminanceIsPartialAndUnreadableImageIsLeftAlone() {
        val mid = LobbyDim.strength(0.575f)
        assertTrue(mid > 0.4f && mid < 0.6f)
        assertEquals(0f, LobbyDim.strength(Float.NaN), 0f)
        assertTrue(LobbyDim.leftLuma(IntArray(3), 32, 18).isNaN())
    }
}
