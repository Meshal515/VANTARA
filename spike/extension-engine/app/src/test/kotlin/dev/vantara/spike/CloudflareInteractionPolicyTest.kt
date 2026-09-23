package dev.vantara.spike

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudflareInteractionPolicyTest {

    @Test
    fun `batch probe fails fast instead of taking over the screen`() {
        assertEquals(
            CloudflareInteractiveAction.FAIL_FAST,
            cloudflareInteractiveAction(batchProbe = true),
        )
    }

    @Test
    fun `manual browsing may still show a human challenge`() {
        assertEquals(
            CloudflareInteractiveAction.SHOW_BROWSER,
            cloudflareInteractiveAction(batchProbe = false),
        )
    }

    @After
    fun restoreDefault() {
        CloudflareInteractionMode.batchProbe = true
    }

    @Test
    fun `the process defaults to failing fast`() {
        // الـspike يُقرأ هذا الافتراض كما كان: لا شاشة تُسرق وسط دفعة
        assertTrue(CloudflareInteractionMode.batchProbe)
        assertEquals(CloudflareInteractiveAction.FAIL_FAST, CloudflareInteractionMode.action())
    }

    @Test
    fun `the reader app opts into the visible challenge`() {
        // القارئ في التطبيق: مستخدمٌ يقلّب بيده، والتحدّي المرئي هو الطريق الوحيد
        CloudflareInteractionMode.batchProbe = false
        assertEquals(CloudflareInteractiveAction.SHOW_BROWSER, CloudflareInteractionMode.action())
    }
}
