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
    @Test fun everySourceBrokenCannotPassPreflight() = runBlocking {
        try {
            AniyomiUpdateGate.verify("old","new",listOf("100","200")) { false }
            fail("An unusable update was admitted")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message.orEmpty().startsWith("ANIYOMI_UPDATE_PREFLIGHT_FAILED"))
        }
    }
    /** AU1: مصدر واحد سليم يكفي، والإخفاقات بسبب البيئة (Cloudflare، HLS مشفّر، magnet) لا ترفض الإصلاح. */
    @Test fun oneWorkingSourceOrEnvironmentOnlyFailuresAdmitTheUpdate() = runBlocking {
        AniyomiUpdateGate.verify("old","new",listOf("100","200","300")) { id ->
            when (id) { "100" -> true; "200" -> error("ANIYOMI_UPDATE_CATALOGUE_EMPTY"); else -> throw IllegalStateException("CANDIDATE_MEDIA_UNVERIFIED", IllegalArgumentException("CANDIDATE_MEDIA_ENCRYPTED_UNVERIFIED")) }
        }
        AniyomiUpdateGate.verify("old","new",listOf("1","2")) { id ->
            if (id == "1") throw IllegalArgumentException("Expected URL scheme 'http' or 'https' but was 'magnet'") else throw java.net.SocketTimeoutException()
        }
    }
    @Test fun incompatibleCandidateCodeIsRejected() = runBlocking {
        try {
            AniyomiUpdateGate.verify("old","new",listOf("1","2")) { id -> if (id == "1") true else throw NoSuchMethodError("x") }
            fail("Incompatible code admitted")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message.orEmpty().contains("RUNTIME_UPDATE_INCOMPATIBLE"))
        }
    }
}
