package com.vantara.plugins.translation

import org.junit.Assert.*
import org.junit.Test

class FastRoiRouterTest {
    private fun safe(
        detector: Float = .95f,
        ocr: Float = .91f,
        containment: Float = .96f,
        spread: Float = 3.0f,
        edges: Float = .08f,
        mask: Float = .95f,
        overlap: Float = .02f,
        glyph: Float = .86f,
        speech: Boolean = true,
    ) = FastRoiRouter.Features(
        detectorConfidence = detector,
        ocrConfidence = ocr,
        holderContainment = containment,
        backgroundSpread = spread,
        edgeDensity = edges,
        maskConfidence = mask,
        overlap = overlap,
        glyphCoverage = glyph,
        speechLike = speech,
    )

    @Test fun `easy trusted speech ROI takes fast lane`() {
        val v = FastRoiRouter.classify(safe())
        assertEquals(FastRoiRouter.Lane.FAST, v.lane)
        assertTrue(v.rejectionReasons.isEmpty())
        assertTrue(v.confidence > .5f)
    }

    @Test fun `OCR rejection promotes only that ROI to CTD when holder stays trusted`() {
        val good = FastRoiRouter.classify(safe())
        val bad = FastRoiRouter.classify(safe(ocr = .58f))
        assertEquals(FastRoiRouter.Lane.FAST, good.lane)
        assertEquals(FastRoiRouter.Lane.CTD, bad.lane)
        assertTrue(bad.rejectionReasons.contains("ocr"))
    }

    @Test fun `untrusted speech background needs bubble rescue while free text only needs CTD`() {
        val speech = FastRoiRouter.classify(safe(spread = 9f))
        val free = FastRoiRouter.classify(safe(spread = 9f, containment = 0f, mask = 0f, speech = false))
        assertEquals(FastRoiRouter.Lane.BUBBLE, speech.lane)
        assertEquals(FastRoiRouter.Lane.CTD, free.lane)
        assertTrue(speech.rejectionReasons.contains("background"))
    }

    @Test fun `majority overlap is a conservative rescue not a page-wide promotion`() {
        val features = listOf(safe(), safe(overlap = .55f), safe(), safe())
        val lanes = FastRoiRouter.classifyAll(features).map { it.lane }
        assertEquals(
            listOf(FastRoiRouter.Lane.FAST, FastRoiRouter.Lane.RESCUE, FastRoiRouter.Lane.FAST, FastRoiRouter.Lane.FAST),
            lanes,
        )
    }

    @Test fun `legacy production safety floors remain hard gates`() {
        assertEquals(FastRoiRouter.Lane.RESCUE, FastRoiRouter.classify(safe(detector = Regions.MIN_SCORE - .01f)).lane)
        assertEquals(FastRoiRouter.Lane.BUBBLE, FastRoiRouter.classify(safe(containment = .83f)).lane)
        assertEquals(FastRoiRouter.Lane.BUBBLE, FastRoiRouter.classify(safe(mask = .83f)).lane)
        assertEquals(FastRoiRouter.Lane.CTD, FastRoiRouter.classify(safe(glyph = .24f)).lane)
    }

    @Test fun `service demand ordering follows measured S23 cost hierarchy`() {
        val fast = FastRoiRouter.classify(safe()).estimatedServiceMs
        val ctd = FastRoiRouter.classify(safe(ocr = .50f)).estimatedServiceMs
        val bubble = FastRoiRouter.classify(safe(spread = 12f)).estimatedServiceMs
        val rescue = FastRoiRouter.classify(safe(overlap = .70f)).estimatedServiceMs
        assertTrue(fast < ctd)
        assertTrue(ctd < bubble)
        assertTrue(bubble <= rescue)
    }
}
