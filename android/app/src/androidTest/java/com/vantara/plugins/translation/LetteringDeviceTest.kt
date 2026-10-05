package com.vantara.plugins.translation

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Paint
import android.graphics.Bitmap
import android.graphics.Canvas
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Device-only shaping proof; compilation is not proof that these have run. */
@RunWith(AndroidJUnit4::class)
class LetteringDeviceTest {
    @Test fun everyPackagedFontOpensWithArabicGlyphs() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        for (family in FontCatalog.families) {
            val face=android.graphics.Typeface.createFromAsset(context.assets,"fonts/translation-v2/$family.ttf")
            val paint=Paint().apply { typeface=face; textSize=40f }
            for (char in "ابتثجحخدذرزسشصضطظعغفقكلمنهويءآأؤإئاةى") assertTrue("$family missing $char",paint.hasGlyph(char.toString()))
        }
    }
    @Test fun shapedEmphasisRemainsInsideFittedBubble() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val catalog=FontCatalog(context.assets)
        val style=LetteringStyle.normalize("threat","blood","strong",listOf("الحاكم العظيم"),"هذا الحاكم العظيم 42!")
        val layout=catalog.layout(style)
        val mask=ByteMask(480,320).apply { fillRect(20,20,460,300) }
        val fit=layout.fitInMask("هذا الحاكم العظيم 42!",mask,Box(40,60,440,250),60f)!!
        val bitmap=Bitmap.createBitmap(480,320,Bitmap.Config.ARGB_8888)
        layout.draw(Canvas(bitmap),fit,false,false,style)
        var visible=0
        for (y in 0 until 320) for (x in 0 until 480) if (bitmap.getPixel(x,y) ushr 24 != 0) {
            visible++;assertTrue("text escaped bubble",mask[x,y].toInt()!=0)
        }
        assertTrue(visible>100);bitmap.recycle()
    }
}
