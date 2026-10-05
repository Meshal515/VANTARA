package com.vantara.plugins.translation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class OrtConfigTest {
    @Test fun `xnnpack heavy sessions do not multiply ORT worker pools`() {
        assertEquals(1, Ort.CURRENT.ortThreads)
        assertEquals(4, Ort.CURRENT.xnnThreads)
        assertFalse(Ort.CURRENT.spin)
    }
}
