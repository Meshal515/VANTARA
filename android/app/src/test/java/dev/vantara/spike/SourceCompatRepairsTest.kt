package dev.vantara.spike

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** SR1: كود الإضافة أولًا، والإصلاح المكتوب احتياط فقط؛ فيسقط وحده حين تُحدَّث الإضافة وتعمل. */
class SourceCompatRepairsTest {
    @Test fun `a working extension wins and the written repair never runs`() = runBlocking {
        var repaired = false
        val out = SourceCompatRepairs.ownFirst({ listOf("c1", "c2") }, { it.isNotEmpty() }) { repaired = true; listOf("r") }
        assertEquals(listOf("c1", "c2"), out)
        assertTrue("repair must not run", !repaired)
    }

    @Test fun `a failing or empty extension falls back to the repair`() = runBlocking {
        assertEquals(listOf("r"), SourceCompatRepairs.ownFirst({ emptyList<String>() }, { it.isNotEmpty() }) { listOf("r") })
        assertEquals(listOf("r"), SourceCompatRepairs.ownFirst<List<String>>({ error("site changed") }, { it.isNotEmpty() }) { listOf("r") })
    }

    @Test fun `when both fail the extension's own reason is reported with the repair attached`() = runBlocking {
        val thrown = runCatching {
            SourceCompatRepairs.ownFirst<List<String>>({ error("own reason") }, { true }) { error("repair reason") }
        }.exceptionOrNull()!!
        assertEquals("own reason", thrown.message)
        assertEquals("repair reason", thrown.suppressed.single().message)
    }
}
