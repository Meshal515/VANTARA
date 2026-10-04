package com.vantara.plugins.translation

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * إعادة محاولة الترجمة لا يجوز أن تعامل التحليل المحفوظ كأنه صفحة بلا نص.
 * إن كان فيه OCR pending، يجب أن يمر عبر finishForLuna ليُنشئ thumbnail جديدة.
 */
class TranslationRetryTest {
    private fun analysis(status: String, source: String): Pipeline.Analysis {
        val mask = PackedMask.of(ByteMask(1, 1))
        val region = Pipeline.Snapshot(
            id = "r1",
            box = Box(0, 0, 1, 1),
            score = 1f,
            kind = "speech",
            bubble = -1,
            bubbleBox = null,
            glyph = mask,
            glyphPixels = 0,
            inkLight = false,
            ocr = null,
            source = source,
            status = status,
        )
        return Pipeline.Analysis("hash", 1, 1, listOf(region), emptyList())
    }

    @Test
    fun cachedReadablePendingAnalysisStillNeedsLuna() {
        assertTrue(Pipeline.needsLuna(analysis("pending", "Hello")))
    }

    @Test
    fun textlessOrUnreadableAnalysisDoesNotNeedLuna() {
        assertFalse(Pipeline.needsLuna(Pipeline.Analysis("hash", 1, 1, emptyList(), emptyList())))
        assertFalse(Pipeline.needsLuna(analysis("skipped:unreadable", "")))
    }
}
