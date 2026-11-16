package com.vantara.anime

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class AnimeSourcePublicationTest {
    @Test fun `removed and reinstalled source rejects old load even when extension bytes match`() {
        val gate = AnimeSourcePublication(Any())
        val obtained = CountDownLatch(1)
        val release = CountDownLatch(1)
        val pool = Executors.newSingleThreadExecutor()
        var published = ""
        try {
            val old = pool.submit<String?> {
                val generation = gate.generation("anime")
                obtained.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                gate.publish("anime", generation) { published = "old"; "old" }
            }
            assertTrue(obtained.await(5, TimeUnit.SECONDS))
            gate.invalidate(listOf("anime")) // uninstall
            gate.invalidate(listOf("anime")) // reinstall same hash
            release.countDown()
            assertNull(old.get(5, TimeUnit.SECONDS))
            assertEquals("", published)
            assertEquals("new", gate.publish("anime", gate.generation("anime")) { published = "new"; "new" })
        } finally { release.countDown(); pool.shutdownNow() }
    }

    @Test fun `publishing validation and cache write share invalidation monitor`() {
        val monitor = Any()
        val gate = AnimeSourcePublication(monitor)
        val entering = CountDownLatch(1)
        val updateRequested = CountDownLatch(1)
        val pool = Executors.newSingleThreadExecutor()
        val cache = mutableMapOf<String, String>()
        try {
            val generation = gate.generation("anime")
            val mutation = pool.submit {
                assertTrue(entering.await(5, TimeUnit.SECONDS))
                updateRequested.countDown()
                synchronized(monitor) { gate.invalidate(listOf("anime")); cache.remove("anime") }
            }
            gate.publish("anime", generation) {
                assertTrue(Thread.holdsLock(monitor))
                entering.countDown()
                assertTrue(updateRequested.await(5, TimeUnit.SECONDS))
                cache["anime"] = "old"
            }
            mutation.get(5, TimeUnit.SECONDS)
            assertTrue(cache.isEmpty())
        } finally { entering.countDown(); pool.shutdownNow() }
    }

    @Test fun `other source changes do not discard an unchanged active load`() {
        val gate = AnimeSourcePublication(Any())
        val generation = gate.generation("anime")
        gate.invalidate(listOf("other"))
        assertEquals("active", gate.publish("anime", generation) { "active" })
    }
}
