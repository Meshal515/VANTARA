package com.vantara.anime.bridge

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/** Guard against promoting updates solely on successful APK/class loading. */
class AniyomiUpdateGateTest {
    @Test fun firstInstallAndUnchangedHashDoNotRiskNetworkProbes() = runBlocking {
        var attempts=0
        val probe:suspend(String)->Boolean={ attempts++;false }
        AniyomiUpdateGate.verify(null,"new",listOf("1","2"),probe)
        AniyomiUpdateGate.verify("SAME","same",listOf("1","2"),probe)
        assertEquals(0,attempts)
    }
    @Test fun updatedMultiSourcePackageProbesEveryPublishedSource() = runBlocking {
        val visited=mutableListOf<String>()
        AniyomiUpdateGate.verify("old","new",listOf("100","200","300")) {
            visited+=it
            true
        }
        assertEquals(listOf("100","200","300"),visited)
    }
    @Test fun aBrokenUpdatedSourceCannotPassPreflight() = runBlocking {
        val visited=mutableListOf<String>()
        try {
            AniyomiUpdateGate.verify("old","new",listOf("100","200","300")) {
                visited+=it
                it!="200"
            }
            fail("An unusable updated source was admitted")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message.orEmpty().startsWith("ANIYOMI_UPDATE_PREFLIGHT_FAILED"))
            assertEquals(listOf("100","200"),visited)
        }
    }
}
