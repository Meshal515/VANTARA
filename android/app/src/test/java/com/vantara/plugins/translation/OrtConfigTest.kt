package com.vantara.plugins.translation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class OrtConfigTest {
    @Test fun `heavy xnnpack sessions do not multiply idle ORT worker pools`() {
        assertEquals(1, Ort.CURRENT.ortThreads)
        assertEquals(4, Ort.CURRENT.xnnThreads)
        assertFalse(Ort.CURRENT.spin)
    }
}
