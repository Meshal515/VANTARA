package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
class RoiProbabilitiesTest {
    @Test fun `overlap averages context without depending on crop order`() {
        val left=Box(0,0,3,2);val right=Box(1,0,4,2)
        val a=RoiProbabilities(4,3);a.add(left,FloatArray(6){.8f});a.add(right,FloatArray(6){.2f})
        val b=RoiProbabilities(4,3);b.add(right,FloatArray(6){.2f});b.add(left,FloatArray(6){.8f})
        assertArrayEquals(a.finish(),b.finish(),.00001f)
        assertEquals(.5f,a.finish()[1],.00001f)
        assertEquals(.8f,a.finish()[0],.00001f)
        assertEquals(0f,a.finish()[8],0f)
    }
}
