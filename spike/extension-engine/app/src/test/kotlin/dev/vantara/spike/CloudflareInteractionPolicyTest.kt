package dev.vantara.spike

import org.junit.Assert.assertEquals
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
}
