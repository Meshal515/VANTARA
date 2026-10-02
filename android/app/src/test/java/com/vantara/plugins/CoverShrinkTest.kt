package com.vantara.plugins

import org.junit.Assert.assertEquals
import org.junit.Test

class CoverShrinkTest {
    @Test
    fun keepsCardSizedCoversAndHalvesHugeOnes() {
        assertEquals(1, CoverShrink.sampleFor(420))
        assertEquals(1, CoverShrink.sampleFor(1100))
        assertEquals(2, CoverShrink.sampleFor(1200))
        assertEquals(4, CoverShrink.sampleFor(2600))
    }
}
