package dev.vantara.spike

import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ImageTransportRecoveryTest {

    @Test
    fun `retries stream reset until the whole image operation succeeds`() = runBlocking {
        var attempts = 0

        val result = retryImageTransport(maxAttempts = 3) {
            attempts += 1
            if (attempts < 3) throw IOException("stream was reset: CANCEL")
            "ok"
        }

        assertEquals("ok", result)
        assertEquals(3, attempts)
    }

    @Test
    fun `does not retry ordinary HTTP or parser failures`() {
        var attempts = 0

        assertThrows(IOException::class.java) {
            runBlocking {
                retryImageTransport(maxAttempts = 3) {
                    attempts += 1
                    throw IOException("HTTP 403")
                }
            }
        }

        assertEquals(1, attempts)
    }

    @Test
    fun `never retries payload size rejection`() {
        var attempts = 0

        assertThrows(PayloadTooLargeException::class.java) {
            runBlocking {
                retryImageTransport(maxAttempts = 3) {
                    attempts += 1
                    throw PayloadTooLargeException("payload exceeded limit")
                }
            }
        }

        assertEquals(1, attempts)
    }
}
