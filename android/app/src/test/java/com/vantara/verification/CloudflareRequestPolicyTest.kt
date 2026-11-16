package com.vantara.verification

import eu.kanade.tachiyomi.network.interceptor.CloudflareRequestKind
import eu.kanade.tachiyomi.network.interceptor.classifyCloudflareRequest
import eu.kanade.tachiyomi.network.interceptor.SILENT_RETRY_MS
import eu.kanade.tachiyomi.network.interceptor.silentSolveAllowed
import org.junit.Assert.assertEquals
import org.junit.Test

class CloudflareRequestPolicyTest {
    @Test fun recordingBackgroundChallengeWaitsForExplicitBegin() {
        val ledger = VerificationLedger()
        val required = ledger.require("example.org", "https://example.org", "https://example.org/", "ua", "cloudflare", "Example", 0)!!
        assertEquals("required", required.state)
        assertEquals("required", ledger.snapshot().single().state)
        assertEquals(required.token, ledger.require("example.org", "https://example.org", "https://example.org/", "ua", "cloudflare", "Example", 1)!!.token)
        assertEquals("required", ledger.snapshot().single().state)
        assertEquals("active", ledger.begin("example.org", 2)!!.state)
    }

    @Test fun explicitChallengeHeaderRequiresHumanRegardlessOfServerOrStatus() {
        for (server in listOf(null, "nginx", "cloudflare")) {
            for (status in listOf(200, 403, 503)) {
                assertEquals(CloudflareRequestKind.HUMAN_CHALLENGE, classifyCloudflareRequest(status, server, " ChAlLeNgE ", false))
                assertEquals(CloudflareRequestKind.HUMAN_CHALLENGE, classifyCloudflareRequest(status, server, "challenge", true))
            }
        }
    }

    @Test fun bareCloudflareDenialsNeverRequireHumanVerification() {
        for (status in listOf(403, 503)) {
            for (mitigated in listOf(null, "", "none", "challenge-other")) {
                assertEquals(CloudflareRequestKind.NONE, classifyCloudflareRequest(status, "cloudflare", mitigated, false))
            }
        }
    }

    @Test fun imageFingerprintDenialRemainsSeparateFromHumanChallenge() {
        for (server in listOf("CloudFlare", "cloudflare-nginx")) {
            for (status in listOf(403, 503)) {
                assertEquals(CloudflareRequestKind.IMAGE_FINGERPRINT, classifyCloudflareRequest(status, server, null, true))
            }
        }
        assertEquals(CloudflareRequestKind.NONE, classifyCloudflareRequest(403, "nginx", null, true))
        assertEquals(CloudflareRequestKind.NONE, classifyCloudflareRequest(200, "cloudflare", null, true))
        assertEquals(CloudflareRequestKind.NONE, classifyCloudflareRequest(429, "cloudflare", null, true))
    }

    // تراجع Debug 0.0.3192: كل غلاف خلف تحدٍّ كان ينشئ WebView مخفيًا على الخيط الرئيسي ويحجز القفل العام
    @Test fun silentSolveNeverRunsForImagesAndOncePerHostWindow() {
        val now = 1_000_000_000L
        assertEquals(false, silentSolveAllowed(isImage = true, lastFailedAt = null, now = now))
        assertEquals(true, silentSolveAllowed(isImage = false, lastFailedAt = null, now = now))
        assertEquals(false, silentSolveAllowed(isImage = false, lastFailedAt = now - 1_000, now = now))
        assertEquals(false, silentSolveAllowed(isImage = false, lastFailedAt = now - SILENT_RETRY_MS + 1, now = now))
        assertEquals(true, silentSolveAllowed(isImage = false, lastFailedAt = now - SILENT_RETRY_MS, now = now))
    }
}
