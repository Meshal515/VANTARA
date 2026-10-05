package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
class InpaintPolicyTest {
    @Test fun `memory and thermal guards retain 1024 fallback`() {
        val gb=1024L*1024*1024
        assertEquals(1536,InpaintPolicy.maxEdge(2*gb,false,0,gb/2))
        assertEquals(1024,InpaintPolicy.maxEdge(gb/2,false,0,gb/2))
        assertEquals(1024,InpaintPolicy.maxEdge(2*gb,true,0,gb/2))
        assertEquals(1024,InpaintPolicy.maxEdge(2*gb,false,2,gb/2))
    }
}
