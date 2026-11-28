package com.vantara.verification

import com.vantara.verification.VerificationTrace.Event
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class VerificationTraceTest {
    @Test fun distinguishesAppLoadFromRepeatedBrowserNavigation() {
        var now = 100L
        val trace = VerificationTrace({ now })
        trace.record(Event.WEBVIEW_CREATE)
        trace.record(Event.APP_LOAD_URL)
        now += 20
        trace.record(Event.PAGE_START)
        trace.record(Event.HTTP_MAIN_CHALLENGE, 403)
        now += 200
        trace.record(Event.PAGE_START)
        val report = trace.report()
        assertTrue(report.contains("WEBVIEW_CREATE=1"))
        assertTrue(report.contains("APP_LOAD_URL=1"))
        assertTrue(report.contains("PAGE_START=2"))
        assertTrue(report.contains("+20ms HTTP_MAIN_CHALLENGE code=403"))
    }
    @Test fun retainsTotalsEvenWhenRecentEntriesAreEvicted() {
        var now = 0L
        val trace = VerificationTrace({ now }, capacity = 2)
        trace.record(Event.APP_LOAD_URL)
        now++
        trace.record(Event.PAGE_START)
        now++
        trace.record(Event.BLOCKED_RESOURCE_DNS)
        val report = trace.report()
        assertTrue(report.contains("APP_LOAD_URL=1"))
        assertFalse(report.contains("+0ms APP_LOAD_URL"))
        assertTrue(report.contains("+2ms BLOCKED_RESOURCE_DNS"))
    }
}
