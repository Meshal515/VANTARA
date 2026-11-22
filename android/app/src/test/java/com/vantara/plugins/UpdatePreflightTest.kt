package com.vantara.plugins

import com.vantara.plugins.UpdatePreflight.Outcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** RH8 وAU1: تحديث إضافة فيديو يُقبل في الحالات الشائعة، ويُرفض فقط حين يكون الإصدار نفسه معطوبًا. */
class UpdatePreflightTest {
    private fun fail(msg: String, cause: Throwable? = null) = Outcome.Failed(IllegalStateException(msg, cause))

    @Test fun searchOnlySourceInAMultiSourcePackageDoesNotBlockTheUpdate() {
        val v = UpdatePreflight.decide(listOf(fail("CANDIDATE_CATALOGUE_EMPTY"), Outcome.Passed, fail("VERIFICATION_REQUIRED")))
        assertTrue(v.accept)
    }
    @Test fun blockedOrChallengedSitesAloneStillAcceptTheFix() {
        assertTrue(UpdatePreflight.decide(listOf(fail("VERIFICATION_REQUIRED"), Outcome.Failed(java.net.UnknownHostException("x")))).accept)
        assertEquals("RUNTIME_UPDATE_UNVERIFIED_ENVIRONMENT", UpdatePreflight.decide(listOf(fail("MEDIA_ENCRYPTED_HLS"))).code)
    }
    @Test fun incompatibleCodeIsRejectedEvenIfAnotherSourcePasses() {
        val v = UpdatePreflight.decide(listOf(Outcome.Passed, fail("boom", NoSuchMethodError("x"))))
        assertFalse(v.accept); assertEquals("RUNTIME_UPDATE_INCOMPATIBLE", v.code)
    }
    @Test fun everySourceFunctionallyBrokenIsRejected() {
        assertFalse(UpdatePreflight.decide(listOf(fail("NO_VIDEO_LINKS"), Outcome.Failed(NullPointerException()))).accept)
        assertFalse(UpdatePreflight.decide(emptyList()).accept)
    }
}
