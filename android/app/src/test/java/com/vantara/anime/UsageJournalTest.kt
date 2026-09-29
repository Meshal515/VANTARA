package com.vantara.anime

import com.vantara.usage.UsageJournal
import com.vantara.usage.UsageOwner
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class UsageJournalTest {
    @Test fun `restart and lost acknowledgement preserve immutable credits for their owner`() {
        val file = Files.createTempDirectory("usage-test").resolve("usage.json").toFile()
        val owner = UsageOwner("u1", "anime", "anime:1", "One", null)
        UsageJournal(file).credit(owner, 5_000, 1_800_000_000_000)
        val journal = UsageJournal(file)
        val first = journal.peek("u1").single()
        assertEquals(5_000L, first.activeMs)
        journal.credit(owner, 2_300, 1_800_000_005_000)
        assertEquals(first, journal.peek("u1").first())
        assertTrue(journal.peek("u2").isEmpty())
        journal.ack("u2", setOf(first.id))
        assertEquals(2, journal.peek("u1").size)
        journal.ack("u1", setOf(first.id))
        assertEquals(2_300L, UsageJournal(file).peek("u1").single().activeMs)
        file.parentFile.deleteRecursively()
    }

    @Test fun `long foreground periods are split without exceeding the server credit limit`() {
        val file = Files.createTempDirectory("usage-test").resolve("usage.json").toFile()
        val journal = UsageJournal(file)
        journal.credit(UsageOwner("u1", "manga", "m1", "M", null), 156 * 60_000L, 1_800_010_000_000)
        var total = 0L
        while (true) {
            val batch = journal.peek("u1")
            if (batch.isEmpty()) break
            assertTrue(batch.all { it.activeMs in 1..60_000L })
            total += batch.sumOf { it.activeMs }
            journal.ack("u1", batch.map { it.id }.toSet())
        }
        assertEquals(9_360_000L, total)
        file.parentFile.deleteRecursively()
    }
}
