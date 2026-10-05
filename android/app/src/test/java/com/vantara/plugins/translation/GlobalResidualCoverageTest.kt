package com.vantara.plugins.translation

import org.junit.Assert.*
import org.junit.Test

class GlobalResidualCoverageTest {
    private fun region(holder:Box):Region {
        val glyph=ByteMask(300,220).apply { fillRect(90,70,180,90) }
        return Region("known",Box(85,65,185,95),.95f,"speech",null,holder,glyph,glyph.count(),false)
    }

    @Test fun `unknown leftover English inside a known holder queues the whole holder for rescue`() {
        val holder=Box(40,30,260,190)
        val leftover=Box(100,135,200,155)
        assertEquals(holder,ResidualLatin.rescueScope(leftover,listOf(region(holder))))
    }

    @Test fun `free leftover text keeps its own scope`() {
        val leftover=Box(10,10,80,30)
        assertEquals(leftover,ResidualLatin.rescueScope(leftover,emptyList()))
    }
}
