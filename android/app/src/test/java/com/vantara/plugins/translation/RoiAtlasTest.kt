package com.vantara.plugins.translation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RoiAtlasTest {
    private fun overlapsWithGutter(a: RoiAtlas.Placement, b: RoiAtlas.Placement, g: Int): Boolean =
        a.atlas == b.atlas && a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g

    @Test fun `typical page crops share one CTD call`() {
        // The owner's report: 4–6 ROIs/page at ~1.8s each. Sizes match HeavyRoi output (text + 64px pad).
        val crops = listOf(Box(40, 100, 420, 380), Box(500, 120, 900, 330), Box(60, 900, 380, 1150),
            Box(520, 1300, 980, 1620), Box(100, 2100, 600, 2400), Box(300, 3000, 700, 3260))
        val plan = RoiAtlas.plan(crops)
        assertEquals(1, plan.atlases)
        assertEquals(crops.size, plan.placements.size)
        for (p in plan.placements) assertEquals("native scale, never upscaled", 1f, p.scale)
        assertTrue(plan.occupancy() > .5f)
    }

    @Test fun `placements stay inside the canvas and keep gutters`() {
        val rnd = java.util.Random(7)
        repeat(200) {
            val crops = List(1 + rnd.nextInt(12)) {
                val w = 40 + rnd.nextInt(700); val h = 30 + rnd.nextInt(700)
                val x = rnd.nextInt(800); val y = rnd.nextInt(5000)
                Box(x, y, x + w, y + h)
            }
            val plan = RoiAtlas.plan(crops)
            assertEquals(crops.size, plan.placements.size)
            for (p in plan.placements) {
                assertTrue(p.x >= 0 && p.y >= 0 && p.x + p.w <= plan.size && p.y + p.h <= plan.size)
                assertEquals(crops[p.index], p.crop)
            }
            for (i in plan.placements.indices) for (j in i + 1 until plan.placements.size)
                assertTrue("gutter violated", !overlapsWithGutter(plan.placements[i], plan.placements[j], plan.gutter))
            // Never more calls than the per-crop path.
            assertTrue(plan.atlases <= crops.size)
        }
    }

    @Test fun `oversized crop is downscaled alone`() {
        val plan = RoiAtlas.plan(listOf(Box(0, 0, 1600, 800), Box(0, 900, 200, 1000)))
        val big = plan.placements[0]
        assertEquals(1024, big.w)
        assertEquals(512, big.h)
        assertTrue(big.scale < 1f)
    }

    @Test fun `atlas probabilities equal a pixel-local model applied to each crop`() {
        // A pixel-local "model" (output = red channel) proves the paste/extract geometry
        // is exact: every crop gets its own pixels back, no neighbour or gutter leaks in.
        val w = 900; val h = 2000
        val img = RgbImage(w, h, ByteArray(w * h * 3) { i -> ((i / 3 * 31 + i % 3 * 7) % 251).toByte() })
        val crops = listOf(Box(10, 10, 300, 200), Box(350, 40, 800, 260), Box(20, 1200, 520, 1500), Box(600, 1700, 880, 1990))
        val plan = RoiAtlas.plan(crops)
        assertEquals(1, plan.atlases)
        val out = RoiAtlas.probabilities(img, crops, plan) { chw ->
            Array(RoiAtlas.SIZE) { y -> FloatArray(RoiAtlas.SIZE) { x -> chw[y * RoiAtlas.SIZE + x] } }
        }
        for ((i, b) in crops.withIndex()) {
            val p = out[i]
            assertEquals(b.area, p.size)
            var k = 0
            for (y in b.y1 until b.y2) for (x in b.x1 until b.x2) {
                assertEquals(img.r(x, y) / 255f, p[k++], 1e-6f)
            }
        }
    }

    @Test fun `many crops spill into a second atlas deterministically`() {
        val crops = List(9) { i -> Box(0, i * 600, 480, i * 600 + 480) }
        val a = RoiAtlas.plan(crops)
        val b = RoiAtlas.plan(crops)
        assertEquals(a, b)
        assertTrue(a.atlases in 2..9)
        assertTrue(a.atlases < crops.size)
    }

    @Test fun `reference scale packs crops at the glyph size the full-width reference sees`() {
        assertEquals(1024f / 1080f, RoiAtlas.referenceScale(1080), 1e-6f)
        val crops = listOf(Box(0, 0, 540, 270), Box(0, 400, 1080, 700))
        val plan = RoiAtlas.plan(crops, scale = RoiAtlas.referenceScale(1080))
        assertEquals(512, plan.placements[0].w)
        assertEquals(1024, plan.placements[1].w)
    }

    @Test fun `stripe path averages overlapping reference stripes into crop-local planes`() {
        val w = 300; val h = 800
        val img = RgbImage(w, h, ByteArray(w * h * 3) { i -> ((i / 3) % 241).toByte() })
        val crops = listOf(Box(10, 20, 200, 120), Box(50, 250, 290, 420), Box(0, 700, 300, 800))
        val spans = RoiAtlas.stripes(w, h, crops)
        // Square stripes of the page width with 12% overlap; every crop row is covered.
        assertTrue(spans.isNotEmpty())
        for (b in crops) for (y in b.y1 until b.y2) assertTrue(spans.any { (y0, y1) -> y in y0 until y1 })
        val out = RoiAtlas.stripeProbabilities(img, crops, spans) { strip -> FloatArray(strip.width * strip.height) { k -> (strip.data[k * 3].toInt() and 0xff).toFloat() } }
        for ((i, b) in crops.withIndex()) {
            var k = 0
            for (y in b.y1 until b.y2) for (x in b.x1 until b.x2) assertEquals(img.r(x, y).toFloat(), out[i][k++], 1e-4f)
        }
    }

    @Test fun `stripes skip page rows without text`() {
        val spans = RoiAtlas.stripes(1000, 6000, listOf(Box(0, 100, 500, 300)))
        assertEquals(1, spans.size)
        assertEquals(0, spans[0].first)
    }

    @Test fun `bubble ROI input follows the crop instead of a fixed 1024 upscale`() {
        assertEquals(512, BubbleSegmenter.roiInputSize(300, 200))
        assertEquals(704, BubbleSegmenter.roiInputSize(690, 400))
        assertEquals(1024, BubbleSegmenter.roiInputSize(1024, 300))
        assertEquals(1024, BubbleSegmenter.roiInputSize(1500, 300))
        for (s in listOf(BubbleSegmenter.roiInputSize(533, 77), BubbleSegmenter.roiInputSize(97, 801))) assertEquals(0, s % 32)
    }
}
