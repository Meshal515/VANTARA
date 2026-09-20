package dev.vantara.spike

import java.io.ByteArrayInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BoundedPayloadReaderTest {

    @Test
    fun `declared oversized image is rejected before reading`() {
        assertThrows(PayloadTooLargeException::class.java) {
            BoundedPayloadReader.read(
                input = ByteArrayInputStream(ByteArray(1)),
                declaredLength = 50,
                maxBytes = 32,
            )
        }
    }

    @Test
    fun `stream that exceeds the limit is rejected even without content length`() {
        assertThrows(PayloadTooLargeException::class.java) {
            BoundedPayloadReader.read(
                input = ByteArrayInputStream(ByteArray(33)),
                declaredLength = -1,
                maxBytes = 32,
            )
        }
    }

    @Test
    fun `payload exactly at the limit is accepted`() {
        val bytes = ByteArray(32) { it.toByte() }

        assertArrayEquals(
            bytes,
            BoundedPayloadReader.read(ByteArrayInputStream(bytes), bytes.size.toLong(), 32),
        )
    }
}
