package dev.vantara.spike

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

class PayloadTooLargeException(message: String) : IOException(message)

/** Reads an untrusted response without ever buffering more than [maxBytes] in memory. */
object BoundedPayloadReader {
    fun read(input: InputStream, declaredLength: Long, maxBytes: Int): ByteArray {
        require(maxBytes > 0) { "maxBytes must be positive" }
        if (declaredLength > maxBytes) {
            throw PayloadTooLargeException(
                "payload declares $declaredLength bytes; limit is $maxBytes",
            )
        }

        val initialSize = when {
            declaredLength in 1..maxBytes.toLong() -> declaredLength.toInt()
            else -> minOf(DEFAULT_INITIAL_CAPACITY, maxBytes)
        }
        val output = ByteArrayOutputStream(initialSize)
        val buffer = ByteArray(minOf(BUFFER_SIZE, maxBytes + 1))
        var total = 0
        while (true) {
            val read = input.read(buffer, 0, minOf(buffer.size, maxBytes - total + 1))
            if (read < 0) break
            if (read == 0) continue
            total += read
            if (total > maxBytes) {
                throw PayloadTooLargeException("payload exceeded $maxBytes bytes")
            }
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }

    private const val BUFFER_SIZE = 16 * 1024
    private const val DEFAULT_INITIAL_CAPACITY = 32 * 1024
}
