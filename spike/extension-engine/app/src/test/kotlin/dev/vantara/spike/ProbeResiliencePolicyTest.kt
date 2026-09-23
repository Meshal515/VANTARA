package dev.vantara.spike

import java.net.UnknownHostException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class ProbeResiliencePolicyTest {

    @Test
    fun `candidate selector skips empty and broken entries`() = runBlocking {
        val calls = mutableListOf<String>()
        val selected = selectFirstNonEmptyCandidate(listOf("empty", "broken", "good"), maxCandidates = 5) { value ->
            calls += value
            when (value) {
                "empty" -> emptyList()
                "broken" -> throw IllegalStateException("bad title")
                else -> listOf(1, 2, 3)
            }
        }

        assertEquals("good", selected.candidate)
        assertEquals(listOf(1, 2, 3), selected.items)
        assertEquals(listOf("empty", "broken", "good"), calls)
    }

    @Test
    fun `candidate selector reports all sampled titles unusable`() {
        val error = assertThrows(NoUsableCandidateException::class.java) {
            runBlocking {
                selectFirstNonEmptyCandidate(listOf("a", "b"), maxCandidates = 2) { emptyList<Int>() }
            }
        }
        assertEquals(2, error.attempted)
    }

    @Test
    fun `transient DNS failure is retried but parser failure is not`() = runBlocking {
        var dnsAttempts = 0
        val value = retryTransientNetwork(maxAttempts = 3, delayMs = 0) {
            dnsAttempts += 1
            if (dnsAttempts < 3) throw UnknownHostException("temporary")
            "ok"
        }
        assertEquals("ok", value)
        assertEquals(3, dnsAttempts)

        var parserAttempts = 0
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking {
                retryTransientNetwork(maxAttempts = 3, delayMs = 0) {
                    parserAttempts += 1
                    throw IllegalArgumentException("parser")
                }
            }
        }
        assertEquals(1, parserAttempts)
    }
}
