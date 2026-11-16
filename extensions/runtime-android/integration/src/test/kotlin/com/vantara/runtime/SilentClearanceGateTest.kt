package com.vantara.runtime

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SilentClearanceGateTest {
    @Test fun oneSilentAttemptPerSourceAndSiteInEachWindow() {
        val gate=SilentClearanceGate(windowMs=1000)
        assertTrue(gate.admit("a|https://x.example",0))
        assertFalse(gate.admit("a|https://x.example",999))
        // مصدر آخر على الموقع نفسه، أو موقع آخر، لا يتأثر
        assertTrue(gate.admit("b|https://x.example",10))
        assertTrue(gate.admit("a|https://y.example",10))
        assertTrue(gate.admit("a|https://x.example",1000))
    }
}
