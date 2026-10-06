package com.vantara.plugins.translation

import org.junit.Assert.assertEquals
import org.junit.Test

class CtdSegMapperTest {
    private fun legacy(
        plane:Array<FloatArray>,
        nw:Int,
        nh:Int,
        outW:Int,
        outH:Int,
    ):FloatArray {
        val mapped=FloatArray(outW*outH)
        for(y in 0 until outH) {
            val fy=((y+.5f)*nh/outH-.5f).coerceIn(0f,(nh-1).toFloat())
            val ya=fy.toInt();val yb=minOf(nh-1,ya+1);val wy=fy-ya
            for(x in 0 until outW) {
                val fx=((x+.5f)*nw/outW-.5f).coerceIn(0f,(nw-1).toFloat())
                val xa=fx.toInt();val xb=minOf(nw-1,xa+1);val wx=fx-xa
                mapped[y*outW+x]=
                    (plane[ya][xa]*(1-wx)+plane[ya][xb]*wx)*(1-wy)+
                    (plane[yb][xa]*(1-wx)+plane[yb][xb]*wx)*wy
            }
        }
        return mapped
    }

    @Test fun `precomputed coordinate remap is bit identical to legacy bilinear loop`() {
        val plane=Array(17) {y->FloatArray(19) {x->
            (((x*37+y*53)%251)-80)/173f
        }}
        for((nw,nh,outW,outH) in listOf(
            intArrayOf(19,17,19,17),
            intArrayOf(13,11,37,29),
            intArrayOf(7,16,31,9),
            intArrayOf(1,1,23,27),
        )) {
            val expected=legacy(plane,nw,nh,outW,outH)
            val actual=CtdSegMapper.map(plane,nw,nh,outW,outH)
            assertEquals(expected.size,actual.size)
            for(i in expected.indices) {
                assertEquals(
                    "raw float mismatch at index $i for $nw x $nh -> $outW x $outH",
                    expected[i].toRawBits(),
                    actual[i].toRawBits(),
                )
            }
        }
    }
}
