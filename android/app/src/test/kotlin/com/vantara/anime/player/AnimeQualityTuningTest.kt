package com.vantara.anime.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AnimeQualityTuningTest {

    @Test
    fun targetSizeAlwaysFits1440pSurface() {
        val cases = listOf(
            568 to 320,
            640 to 360,
            854 to 480,
            960 to 540,
            1024 to 576,
            1280 to 720,
            1600 to 900,
            1920 to 1080,
        )
        for ((w, h) in cases) {
            val (outW, outH) = Anime4kEffect.targetSize(w, h)
            assertTrue("height must fit QHD for ${h}p", outH <= 1440)
            assertTrue("width must fit QHD", outW <= 2560)
            assertTrue("width must stay even", outW % 2 == 0)
            assertTrue("height must stay even", outH % 2 == 0)
            // Integer/even rounding may leave 1–2 output rows unused for non-exact aspect ratios.
            val inputAspect = w.toFloat() / h.toFloat()
            val outputAspect = outW.toFloat() / outH.toFloat()
            assertTrue("aspect ratio must be preserved", kotlin.math.abs(inputAspect - outputAspect) < 0.003f)
            assertTrue("one dimension should reach the 1440p/QHD boundary", outH >= 1436 || outW >= 2556)
        }
    }

    @Test
    fun lowResolutionGetsMoreReconstructionThan1080p() {
        val p320 = AnimeQualityTuning.forSourceHeight(320, Anime4kEffect.Mode.STRONG)
        val p720 = AnimeQualityTuning.forSourceHeight(720, Anime4kEffect.Mode.STRONG)
        val p1080 = AnimeQualityTuning.forSourceHeight(1080, Anime4kEffect.Mode.STRONG)

        assertTrue(p320.cleanup > p720.cleanup)
        assertTrue(p720.cleanup > p1080.cleanup)
        assertTrue(p320.deblur > p720.deblur)
        assertTrue(p720.deblur > p1080.deblur)
        assertTrue(p320.lineRestore > p720.lineRestore)
        assertTrue(p720.lineRestore > p1080.lineRestore)
        assertTrue(p320.antiAlias > p720.antiAlias)
        assertTrue(p720.antiAlias > p1080.antiAlias)
    }

    @Test
    fun commonSourceTiersAreActuallyDifferent() {
        val heights = listOf(320, 360, 480, 540, 576, 720, 900, 1080)
        val tunings = heights.map { AnimeQualityTuning.forSourceHeight(it, Anime4kEffect.Mode.STRONG) }

        for (i in 1 until tunings.size) {
            assertTrue(
                "${heights[i - 1]}p and ${heights[i]}p should not share the same line tuning",
                tunings[i - 1].lineRestore != tunings[i].lineRestore,
            )
        }
    }

    @Test
    fun balancedKeepsSameResolutionPolicyButLowerCost() {
        val strong = AnimeQualityTuning.forSourceHeight(720, Anime4kEffect.Mode.STRONG)
        val balanced = AnimeQualityTuning.forSourceHeight(720, Anime4kEffect.Mode.BALANCED)

        assertTrue(balanced.cleanup < strong.cleanup)
        assertTrue(balanced.deblur < strong.deblur)
        assertTrue(balanced.detail < strong.detail)
        assertTrue(balanced.antiAlias < strong.antiAlias)
    }
}
