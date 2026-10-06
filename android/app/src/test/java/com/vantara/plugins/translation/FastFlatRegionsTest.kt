package com.vantara.plugins.translation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FastFlatRegionsTest {
    private fun image(w: Int = 220, h: Int = 180): RgbImage {
        val data = ByteArray(w * h * 3)
        // رسم رمادي خارج الفقاعة.
        for (i in 0 until w * h) {
            data[i * 3] = 90.toByte()
            data[i * 3 + 1] = 90.toByte()
            data[i * 3 + 2] = 90.toByte()
        }
        fun paint(x0: Int, y0: Int, x1: Int, y1: Int, v: Int) {
            for (y in y0 until y1) for (x in x0 until x1) {
                val i = (y * w + x) * 3
                data[i] = v.toByte(); data[i + 1] = v.toByte(); data[i + 2] = v.toByte()
            }
        }
        // فقاعة بيضاء مسطحة.
        paint(35, 30, 185, 145, 246)
        // نص إنجليزي اصطناعي: عدة مكونات داكنة داخل صندوق النص.
        paint(70, 68, 76, 91, 20)
        paint(80, 68, 87, 91, 20)
        paint(92, 68, 98, 91, 20)
        paint(104, 68, 112, 91, 20)
        paint(118, 68, 125, 91, 20)
        paint(72, 100, 82, 122, 25)
        paint(88, 100, 97, 122, 25)
        paint(104, 100, 114, 122, 25)
        return RgbImage(w, h, data)
    }

    @Test
    fun `uniform speech bubble skips neural glyph and bubble models`() {
        val img = image()
        val dets = listOf(
            Detection(Box(35, 30, 185, 145), 0.96f, "bubble"),
            Detection(Box(64, 62, 132, 126), 0.95f, "text_bubble"),
        )
        val out = Regions.fastFlatRegions(img, img.gray(), "hash", dets)
        assertNotNull(out)
        assertEquals(1, out!!.size)
        assertEquals("speech", out[0].kind)
        assertTrue(out[0].glyphPixels >= Regions.MIN_GLYPH_PIXELS)
        assertNotNull(out[0].bubble)
    }

    @Test
    fun `textured bubble refuses fast path instead of sacrificing quality`() {
        val img = image()
        // حوّل الفقاعة إلى checkerboard قوي: ليست خلفية قابلة للتعبئة الآمنة.
        for (y in 30 until 145) for (x in 35 until 185) {
            val v = if (((x / 5) + (y / 5)) % 2 == 0) 235 else 160
            val i = (y * img.width + x) * 3
            img.data[i] = v.toByte(); img.data[i + 1] = v.toByte(); img.data[i + 2] = v.toByte()
        }
        val dets = listOf(
            Detection(Box(35, 30, 185, 145), 0.96f, "bubble"),
            Detection(Box(64, 62, 132, 126), 0.95f, "text_bubble"),
        )
        assertNull(Regions.fastFlatRegions(img, img.gray(), "hash", dets))
    }

    @Test
    fun `free text refuses fast path`() {
        val img = image()
        val dets = listOf(Detection(Box(64, 62, 132, 126), 0.95f, "text_free"))
        assertNull(Regions.fastFlatRegions(img, img.gray(), "hash", dets))
    }

    @Test
    fun `tight detector holder can pass when pixel evidence proves it safe`() {
        val w=700; val h=700
        val data=ByteArray(w*h*3){90.toByte()}
        fun paint(x0:Int,y0:Int,x1:Int,y1:Int,v:Int) {
            for(y in y0 until y1) for(x in x0 until x1) for(c in 0..2) data[(y*w+x)*3+c]=v.toByte()
        }
        paint(50,50,650,650,246)
        for(x in listOf(270,290,312,336,362)) paint(x,300,x+9,338,20)
        for(x in listOf(282,308,338)) paint(x,365,x+11,403,25)
        val img=RgbImage(w,h,data)
        val holder = Detection(Box(50,50,650,650), 0.96f, "bubble")
        // 600² / 560² = ~1.148x. The old geometric 1.18x area gate rejected
        // this before inspecting the actual flat paper. Large margins preserve
        // enough independent background samples for the real safety gate.
        val text = Detection(Box(70,70,630,630), 0.95f, "text_bubble")
        assertTrue(holder.box.area < text.box.area * 1.18f)
        val plan = Regions.fastFlatPlan(img, img.gray(), "hash", listOf(holder, text))
        assertEquals(plan.rejectionReasons.toString(),1, plan.fast.size)
        assertTrue(plan.heavy.isEmpty())
        assertEquals("speech", plan.fast.single().kind)
    }

    @Test
    fun `partial paper component across a speech holder refuses fast path`() {
        val w=240; val h=180
        val data=ByteArray(w*h*3){90.toByte()}
        fun paint(x0:Int,y0:Int,x1:Int,y1:Int,v:Int) {
            for(y in y0 until y1) for(x in x0 until x1) for(c in 0..2) data[(y*w+x)*3+c]=v.toByte()
        }
        // One detector holder, but the "paper" is split into two disconnected
        // components. The left component contains the claimed OCR text and is
        // locally flat; accepting it would leave possible English on the right.
        paint(30,25,210,155,246)
        paint(128,25,140,155,90)
        for(x in listOf(55,70,86,103)) paint(x,70,x+7,98,20)
        val img=RgbImage(w,h,data)
        val holder=Detection(Box(30,25,210,155),.97f,"bubble")
        val text=Detection(Box(48,62,118,106),.96f,"text_bubble")
        val plan=Regions.fastFlatPlan(img,img.gray(),"hash",listOf(holder,text))
        assertTrue(plan.fast.isEmpty())
        assertEquals(listOf(text),plan.heavy)
        assertEquals("holder_mask",plan.rejectionReasons[text])
    }

}
