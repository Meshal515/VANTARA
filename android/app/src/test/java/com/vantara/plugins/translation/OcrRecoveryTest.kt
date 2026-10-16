package com.vantara.plugins.translation

import org.junit.Assert.*
import org.junit.Test

class OcrRecoveryTest {
    private val boxes = listOf(Box(10,10,80,30), Box(10,40,80,60))

    @Test fun `empty line cannot disappear beside a readable line`() {
        val result=OcrRecovery.read(boxes) { box, _ -> if(box==boxes[0]) "HELLO" to .95f else "" to 0f }
        assertEquals(1,result.failedLines)
        assertEquals(2,result.lines.size)
        assertTrue(result.confidence < Regions.MIN_OCR_CONF)
    }

    @Test fun `only the failed line retries with OCR-only padding`() {
        val calls=ArrayList<Pair<Box,Int>>()
        val result=OcrRecovery.read(boxes) { box,pad ->
            calls.add(box to pad)
            if(box==boxes[0]) "HELLO" to .95f else if(pad==8) "WORLD" to .9f else "" to 0f
        }
        assertEquals("HELLO WORLD",result.text)
        assertEquals(0,result.failedLines)
        assertEquals(1,result.retriedLines)
        assertEquals(listOf(boxes[0] to 4,boxes[1] to 4,boxes[1] to 8),calls)
        assertEquals(boxes,result.lines.map {it.box})
    }

    @Test fun `low confidence line cannot hide behind the mean`() {
        val result=OcrRecovery.read(boxes) { box,_ -> if(box==boxes[0]) "HELLO" to .99f else "NOISE" to .3f }
        assertEquals(1,result.failedLines)
        assertTrue(result.confidence < Regions.MIN_OCR_CONF)
    }

    @Test fun `retry budget is finite and rejected text stays rejected`() {
        var calls=0
        val result=OcrRecovery.read(List(20) {Box(0,it*20,80,it*20+15)}) {_,_->calls++;"" to 0f}
        assertEquals(20,result.failedLines)
        assertEquals(4,result.retriedLines)
        assertEquals(24,calls)
    }

    @Test fun `no line evidence is unreadable and never guesses the whole drawing`() {
        val result=OcrRecovery.read(emptyList()) {_,_->error("must not infer")}
        assertTrue(result.text.isEmpty())
        assertEquals(0f,result.confidence,0f)
    }
}
