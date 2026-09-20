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
}
