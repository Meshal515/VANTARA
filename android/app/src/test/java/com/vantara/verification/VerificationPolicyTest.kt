package com.vantara.verification

import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress

class VerificationPolicyTest {
    @Test fun onlyPublicHttpsOriginsCanBePending() {
        assertEquals("https://example.org", VerificationPolicy.endpoint("https://example.org/chapter?q=secret")?.origin)
        listOf("http://example.org/", "https://user:secret@example.org/", "https://localhost/", "https://a.local/", "https://127.0.0.1/", "https://[::1]/", "https://2130706433/", "https://192.168.1.4/", "https://example.org:444/", "file:///etc/passwd").forEach {
            assertNull(it, VerificationPolicy.endpoint(it))
        }
    }

    @Test fun clearanceImportCannotInjectAttributesOrOtherCookies() {
        assertEquals("abc-123_.$", VerificationPolicy.clearance("other=value; cf_clearance=abc-123_.$; session=secret"))
        assertNull(VerificationPolicy.clearance("session=secret"))
        assertNull(VerificationPolicy.clearance("cf_clearance=a\r\nSet-Cookie: session=secret"))
        assertNull(VerificationPolicy.clearance("cf_clearance=one; cf_clearance=two"))
    }

    @Test fun resolvedLocalAndReservedAddressesAreRejected() {
        listOf("0.0.0.4", "10.1.2.3", "127.0.0.1", "169.254.1.2", "172.17.0.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "240.1.1.1", "::1", "fc00::1", "fe80::1", "64:ff9b::a00:1").forEach {
            assertFalse(it, VerificationPolicy.publicAddress(InetAddress.getByName(it)))
        }
        assertTrue(VerificationPolicy.publicAddress(InetAddress.getByName("1.1.1.1")))
        assertTrue(VerificationPolicy.publicAddress(InetAddress.getByName("2606:4700:4700::1111")))
    }

    @Test fun duplicateChallengeKeepsOneTokenAndActiveSession() {
        val ledger = VerificationLedger(2, 100)
        val first = ledger.require("example.org", "https://example.org", "https://example.org/", "ua", "cloudflare", "Example", 0)!!
        assertEquals(first.token, ledger.require("example.org", "https://example.org", "https://example.org/other", "ua", "cloudflare", "Example", 1)!!.token)
        assertNotNull(ledger.begin("example.org", 2))
        assertNull(ledger.begin("example.org", 3))
        assertNotNull(ledger.require("other.org", "https://other.org", "https://other.org/", "ua", "cloudflare", "Other", 3))
        assertNull(ledger.begin("other.org", 4))
        assertNull(ledger.finish("example.org", "wrong-token"))
        assertEquals(first.token, ledger.finish("example.org", first.token)?.token)
        assertNotNull(ledger.begin("other.org", 5))
    }

    @Test fun pendingWorkStaysBoundedAndRequiredAfterExpiryUntilExplicitSuccess() {
        val ledger = VerificationLedger(1, 100)
        val first = ledger.require("example.org", "https://example.org", "https://example.org/", "ua", "cloudflare", "Example", 0)!!
        assertNull(ledger.require("other.org", "https://other.org", "https://other.org/", "ua", "cloudflare", "Other", 1))
        val expired = ledger.expire(101)
        assertEquals(1, expired.size)
        assertEquals(1, ledger.snapshot().size)
        val pending = ledger.snapshot().single()
        assertEquals("required", pending.state)
        assertEquals(101L, pending.createdAt)
        assertNotEquals(first.token, pending.token)
        assertEquals(pending, expired.single())
        assertTrue(ledger.expire(102).isEmpty())
        assertNull(ledger.finish("example.org", first.token))
        assertNull(ledger.require("other.org", "https://other.org", "https://other.org/", "ua", "cloudflare", "Other", 102))
        assertEquals(pending.token, ledger.begin("example.org", 103)?.token)
        assertNotNull(ledger.finish("example.org", pending.token))
        assertTrue(ledger.snapshot().isEmpty())
    }

    @Test fun cancellationOrFailureKeepsChallengeForManualRetryWithFreshToken() {
        listOf("cancelled", "failed").forEach { outcome ->
            val ledger = VerificationLedger(1, 100)
            val first = ledger.require("example.org", "https://example.org", "https://example.org/", "ua", "cloudflare", "Example", 0)!!
            assertNotNull(outcome, ledger.begin("example.org", 1))
            assertNull(outcome, ledger.retry("example.org", "wrong-token", 2))
            assertEquals(outcome, "active", ledger.snapshot().single().state)
            val retry = ledger.retry("example.org", first.token, 3)!!
            assertEquals(outcome, "required", retry.state)
            assertNotEquals(outcome, first.token, retry.token)
            assertEquals(outcome, 3L, retry.createdAt)
            assertEquals(outcome, first.url, retry.url)
            assertEquals(outcome, first.userAgent, retry.userAgent)
            assertEquals(outcome, first.sourceName, retry.sourceName)
            assertEquals(outcome, listOf(retry), ledger.snapshot())
            assertNull(outcome, ledger.finish("example.org", first.token))
            assertNull(outcome, ledger.retry("example.org", first.token, 4))
            assertEquals(outcome, retry.token, ledger.begin("example.org", 4)?.token)
            assertNotNull(outcome, ledger.finish("example.org", retry.token))
            assertTrue(outcome, ledger.snapshot().isEmpty())
        }
    }

    @Test fun expiredActiveSessionRotatesTokenWithoutOpeningAnotherSession() {
        val ledger = VerificationLedger(2, 100)
        val first = ledger.require("example.org", "https://example.org", "https://example.org/", "ua", "cloudflare", "Example", 0)!!
        assertNotNull(ledger.begin("example.org", 1))
        assertEquals("required", ledger.expire(100).single().state)
        assertFalse(ledger.snapshot().any { it.state == "active" })
        assertNull(ledger.finish("example.org", first.token))
        assertNotNull(ledger.begin("example.org", 101))
    }
}
