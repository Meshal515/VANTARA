package com.vantara.plugins.translation

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class RoiMaskComposerTest {
    private fun legacy(width:Int,height:Int,crops:List<Box>,probs:List<FloatArray>,threshold:Float=.3f):ByteMask {
        val ref=RoiProbabilities(width,height)
        for(i in crops.indices) ref.add(crops[i],probs[i])
        val p=ref.finish()
        return ByteMask(width,height).also {m->
            for(i in p.indices) if(p[i]>threshold) m.data[i]=1
        }
    }

    @Test fun `disjoint ROI composition is byte identical to full page accumulator`() {
        val crops=listOf(Box(10,10,30,25),Box(80,60,110,90))
        val probs=crops.mapIndexed {i,b->FloatArray(b.area) {k-> ((k+i*7)%11)/10f } }
        val expected=legacy(140,120,crops,probs)
        val actual=RoiMaskComposer.threshold(140,120,crops,probs,.3f)
        assertArrayEquals(expected.data,actual.data)
    }

    @Test fun `overlapping and transitive ROI composition preserves averaging exactly`() {
        val crops=listOf(
            Box(10,10,45,40),
            Box(35,20,70,55),
            Box(60,45,95,80),
        )
        val probs=crops.mapIndexed {i,b->
            FloatArray(b.area) {k-> (((k*13)+(i*17))%101)/100f }
        }
        val expected=legacy(120,100,crops,probs,.3f)
        val actual=RoiMaskComposer.threshold(120,100,crops,probs,.3f)
        assertArrayEquals(expected.data,actual.data)
    }

    @Test fun `edge touching ROI do not allocate an overlap cluster and remain identical`() {
        val crops=listOf(Box(0,0,20,20),Box(20,0,40,20),Box(40,0,60,20))
        val probs=crops.mapIndexed {i,b->FloatArray(b.area) {if((it+i)%3==0) .31f else .29f} }
        val expected=legacy(60,20,crops,probs)
        val actual=RoiMaskComposer.threshold(60,20,crops,probs,.3f)
        assertArrayEquals(expected.data,actual.data)
    }
}
