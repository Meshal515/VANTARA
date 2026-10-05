package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
class ResidualLatinTest {
    @Test fun `requires confident Latin words in translated text`() {
        assertTrue(ResidualLatin.readable("HELLO",.93f,"speech"))
        assertFalse(ResidualLatin.readable("HELLO",.60f,"speech"))
        assertFalse(ResidualLatin.readable("BOOM",.99f,"sfx"))
        assertFalse(ResidualLatin.readable("42 i",.99f,"speech"))
        assertFalse(ResidualLatin.readable("مرحبا",.99f,"speech"))
    }
 @Test fun `short standalone English dialogue cannot pass the gate`() {
  assertTrue(ResidualLatin.readable("GO",.95f,"speech"))
  assertTrue(ResidualLatin.readable("NO!",.95f,"speech"))
 }
}
