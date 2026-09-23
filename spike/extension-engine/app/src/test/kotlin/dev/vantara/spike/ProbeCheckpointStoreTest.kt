package dev.vantara.spike

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProbeCheckpointStoreTest {

    @Test
    fun `report survives recreation and completed sources are skipped`() {
        val dir = Files.createTempDirectory("vantara-probe-test").toFile()
        val first = ProbeCheckpointStore(dir)

        first.reset(listOf("safe-one", "nsfw-two", "safe-three"))
        first.appendLine("safe-one passed")
        first.markCompleted("safe-one")

        val recreated = ProbeCheckpointStore(dir)

        assertEquals("safe-one passed\n", recreated.readReport())
        assertEquals(listOf("nsfw-two", "safe-three"), recreated.remaining())
    }

    @Test
    fun `marking the same source twice is idempotent`() {
        val dir = Files.createTempDirectory("vantara-probe-test").toFile()
        val store = ProbeCheckpointStore(dir)
        store.reset(listOf("a", "b"))

        store.markCompleted("a")
        store.markCompleted("a")

        assertEquals(listOf("b"), store.remaining())
        assertTrue(store.hasCheckpoint())
    }

    @Test
    fun `final mark survives process death without erasing the completed report`() {
        val dir = Files.createTempDirectory("vantara-probe-test").toFile()
        ProbeCheckpointStore(dir).apply {
            reset(listOf("only-source"))
            appendLine("complete audit")
            markCompleted("only-source")
        }

        val recreated = ProbeCheckpointStore(dir)
        assertTrue(recreated.hasPlan())
        assertTrue(recreated.remaining().isEmpty())
        assertEquals("complete audit\n", recreated.readReport())

        recreated.finish()
        assertEquals("complete audit\n", recreated.readReport())
    }

    @Test
    fun `checkpoint from a different source snapshot is discarded`() {
        val dir = Files.createTempDirectory("vantara-probe-test").toFile()
        ProbeCheckpointStore(dir).apply {
            ensureSnapshot("old-snapshot")
            reset(listOf("old-source"))
            appendLine("old report")
        }

        val recreated = ProbeCheckpointStore(dir)
        recreated.ensureSnapshot("new-snapshot")

        assertEquals("", recreated.readReport())
        assertTrue(recreated.remaining().isEmpty())
        assertTrue(!recreated.hasPlan())
    }

    @Test
    fun `manual clear keeps the current snapshot binding`() {
        val dir = Files.createTempDirectory("vantara-probe-test").toFile()
        ProbeCheckpointStore(dir).apply {
            ensureSnapshot("current-snapshot")
            clear()
            reset(listOf("current-source"))
            appendLine("current report")
        }

        val recreated = ProbeCheckpointStore(dir)
        recreated.ensureSnapshot("current-snapshot")

        assertEquals("current report\n", recreated.readReport())
        assertEquals(listOf("current-source"), recreated.remaining())
    }
}
