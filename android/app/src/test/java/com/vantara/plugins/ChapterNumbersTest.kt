package com.vantara.plugins

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChapterNumbersTest {
    @Test
    fun decimalChaptersKeepTheNumberTheSourceWrote() {
        // كان 356.1000061035156 بجانب 356.1: فصل مكرر ومفتاحا تقدم
        assertEquals(356.1, ChapterNumbers.forJs(356.1f), 0.0)
        assertEquals(22.1, ChapterNumbers.forJs(22.1f), 0.0)
        assertEquals(0.5, ChapterNumbers.forJs(0.5f), 0.0)
        assertEquals(1047.5, ChapterNumbers.forJs(1047.5f), 0.0)
    }

    @Test
    fun wholeAndUnknownNumbersAreUnchanged() {
        assertEquals(232.0, ChapterNumbers.forJs(232f), 0.0)
        assertEquals(-1.0, ChapterNumbers.forJs(-1f), 0.0)
        assertTrue(ChapterNumbers.forJs(Float.NaN).isNaN())
    }
}
