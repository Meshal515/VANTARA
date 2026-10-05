package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
class LetteringStyleTest {
    @Test fun `closed style keeps whole words and caps emphasis`() {
        val style = LetteringStyle.normalize("evil/path","rainbow","giant",listOf("حاكم","الحاكم","العظيم","الحاكم العظيم","الحاكم"),"الحاكم العظيم")
        assertEquals("neutral",style.role); assertEquals("auto",style.ink); assertEquals("normal",style.intensity)
        assertEquals(listOf("الحاكم","العظيم","الحاكم العظيم"),style.emphasis)
    }
    @Test fun `dark dramatic ink cannot hide on a dark source background`() {
        assertEquals(0xFFFFFFFF.toInt(),LetteringStyle(ink="blood").color(true))
        assertEquals(0xFF790F1F.toInt(),LetteringStyle(ink="blood").color(false))
    }
}
