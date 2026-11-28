package com.vantara.verification

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * نقل جلسة التحقق إلى مخزن المحرك، بالمقارنة مع Mihon (مخزن CookieManager واحد، وحذف cf_clearance القديم قبل كل حل).
 * فشل التحقق عند المالك منذ بناء النظام: الجديد كان يُكتب «للمضيف وحده» على المضيف الذي انتهت إليه الصفحة، والقديم
 * (من الحل الصامت بنطاق الموقع) يبقى، فيُرسل الاثنان والأقدم أولًا.
 */
class VerificationSessionTest {
    /** القديم يُحذف بكل نطاقاته قبل كتابة الجديد على جذر الموقع. */
    @Test fun staleClearanceIsRemovedEverywhereBeforeTheSiteWideImport() {
        val w = VerificationPolicy.sessionImport("www.hijala.com", "hijala.com", "NEW", emptyList(), "hijala.com")
        val removals = w.takeWhile { it.remove }
        // المضيفان كلاهما وجذر الموقع، قبل أي كتابة
        assertEquals(3, removals.size)
        assertTrue(removals.any { it.url == "https://www.hijala.com/" && it.header == "cf_clearance=; Path=/; Max-Age=0" })
        assertTrue(removals.any { it.url == "https://hijala.com/" && it.header == "cf_clearance=; Path=/; Max-Age=0" })
        assertTrue(removals.any { it.header == "cf_clearance=; Domain=.hijala.com; Path=/; Max-Age=0" })
        val writes = w.drop(removals.size)
        assertEquals(1, writes.size)
        // نطاق الموقع كما يكتبه Cloudflare: يصل www ودونها والنطاقات الفرعية، ويحل محل القديم بالمفتاح نفسه
        assertTrue(writes.single().header.startsWith("cf_clearance=NEW; Domain=.hijala.com; Path=/; Secure; HttpOnly"))
        assertTrue(writes.single().header.contains("Max-Age=${VerificationPolicy.IMPORT_MAX_AGE_S}"))
    }

    /** بقية الكوكيز للمضيفين كليهما، ولا cf_clearance مكرر. */
    @Test fun otherCookiesReachBothHostsWithoutDuplicateClearance() {
        val w = VerificationPolicy.sessionImport("www.site.com", "site.com", "C", listOf("sid" to "1", "cf_clearance" to "dup"), "site.com")
        val sid = w.filter { it.header.startsWith("sid=1;") }.map { it.url }
        assertEquals(listOf("https://www.site.com/", "https://site.com/"), sid)
        assertEquals(1, w.count { it.header.startsWith("cf_clearance=C;") })
        assertFalse(w.any { it.header.startsWith("cf_clearance=dup") })
    }

    /** بلا جذر معروف: المضيفان كلاهما. */
    @Test fun withoutRegistrableDomainBothHostsAreWritten() {
        val w = VerificationPolicy.sessionImport("a.example", "a.example", "C", emptyList(), null)
        assertEquals(listOf("https://a.example/"), w.filter { !it.remove }.map { it.url })
        assertTrue(w.none { it.header.contains("Domain=") })
    }

    /** حكم الموقع بعد النقل، لا حكم الصفحة. */
    @Test fun theSiteDecidesAfterTheImportNotThePage() {
        fun v(code: Int, server: String?, mitigated: String?, body: String?) = VerificationAcceptance.verdictOf(code, server, mitigated, body)
        assertEquals(VerificationAcceptance.Verdict.CHALLENGED, v(403, "cloudflare", "challenge", null))
        assertEquals(VerificationAcceptance.Verdict.CHALLENGED, v(503, "cloudflare", null, "<html><title>Just a moment...</title>"))
        assertEquals(VerificationAcceptance.Verdict.CHALLENGED, v(200, "cloudflare", null, "<html><head><title>Just a moment...</title>"))
        // صفحة عادية يحقن فيها Cloudflare سكربت challenge-platform للكشف: مقبولة
        assertEquals(VerificationAcceptance.Verdict.ACCEPTED, v(200, "cloudflare", null, "<html><title>هيجالا</title><script src=\"/cdn-cgi/challenge-platform/scripts/jsd/main.js\">"))
        assertEquals(VerificationAcceptance.Verdict.ACCEPTED, v(404, "cloudflare", null, "<title>Not found</title>"))
        assertEquals(VerificationAcceptance.Verdict.UNREACHABLE, v(429, "nginx", null, null))
        assertEquals(VerificationAcceptance.Verdict.UNREACHABLE, v(502, "cloudflare", null, null))
    }
}
