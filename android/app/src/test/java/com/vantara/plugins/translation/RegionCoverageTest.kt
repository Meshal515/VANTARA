package com.vantara.plugins.translation

import org.junit.Assert.*
import org.junit.Test

class RegionCoverageTest {
    @Test fun `unclaimed CTD glyphs inside a speech holder become rescue detections`() {
        val w=320; val h=220
        val img=RgbImage(w,h,ByteArray(w*h*3){255.toByte()})
        val holder=Box(40,30,280,190)
        val bubbleMask=ByteMask(w,h).apply { fillRect(holder.x1,holder.y1,holder.x2,holder.y2) }
        val glyph=ByteMask(w,h)
        // detector knew only the upper line
        glyph.fillRect(90,65,200,82)
        // CTD also saw a far lower line the detector missed
        glyph.fillRect(95,135,205,154)
        val known=listOf(
            Detection(Box(84,60,208,88),.96f,"text_bubble"),
            Detection(holder,.96f,"bubble"),
        )
        val rescued=Regions.unclaimedGlyphDetections(
            img,
            glyph,
            known,
            listOf(Bubble(holder,.96f,bubbleMask)),
        )
        assertTrue(rescued.any { it.label=="text_bubble" && it.box.y1 <= 135 && it.box.y2 >= 154 })
    }
}
