package com.vantara.verification

import com.vantara.plugins.ExtensionFailure
import com.vantara.verification.VerificationAcceptance.Verdict
import eu.kanade.tachiyomi.network.interceptor.CloudflareBypassException
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Test

class VerificationLifecycleRegressionTest {
    @Test fun networkTextDoesNotRequireHumanVerification() {
        assertEquals("SITE_NETWORK", ExtensionFailure.classify(IOException("Cloudflare connection reset")).code)
    }
    @Test fun noninteractiveTypedFailureIsNetworkFailure() {
        assertEquals("SITE_NETWORK", ExtensionFailure.classify(CloudflareBypassException("Cloudflare failed", false)).code)
    }
    @Test fun interactiveTypedChallengeIsPreserved() {
        assertEquals("SITE_VERIFICATION", ExtensionFailure.classify(CloudflareBypassException("Cloudflare wants a human check", true)).code)
    }
    @Test fun ordinary403IsNotChallengeOrAcceptance() {
        assertEquals(Verdict.UNREACHABLE, VerificationAcceptance.verdictOf(403, "cloudflare", null, "<title>Forbidden</title>"))
    }
    @Test fun ordinary503IsNotChallengeOrAcceptance() {
        assertEquals(Verdict.UNREACHABLE, VerificationAcceptance.verdictOf(503, "cloudflare", null, "<title>Service unavailable</title>"))
    }
    @Test fun ordinary401IsNotAcceptance() {
        assertEquals(Verdict.UNREACHABLE, VerificationAcceptance.verdictOf(401, "nginx", null, "<title>Unauthorized</title>"))
    }
    @Test fun explicitChallengeStillRequiresVerification() {
        assertEquals(Verdict.CHALLENGED, VerificationAcceptance.verdictOf(403, "cloudflare", "challenge", null))
    }
    @Test fun challengePageTitleStillRequiresVerification() {
        assertEquals(Verdict.CHALLENGED, VerificationAcceptance.verdictOf(503, "cloudflare", null, "<title>Just a moment...</title>"))
    }
    @Test fun ordinarySuccessRemainsSuccess() {
        assertEquals(Verdict.ACCEPTED, VerificationAcceptance.verdictOf(200, "cloudflare", null, "<title>Catalog</title>"))
    }
}
