package com.vantara.plugins

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream

class BoundedRepositoryBodyTest {
    @Test fun unknownLengthStopsAtTheLimitPlusOneByte() {
        var consumed = 0
        val neverEnding = object : InputStream() {
            override fun read(): Int { consumed++; return 42 }
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                consumed += length; buffer.fill(42, offset, offset + length); return length
            }
        }
        assertThrows(IllegalArgumentException::class.java) { readRepositoryBody(neverEnding, -1, 16_384) }
        assertEquals(16_385, consumed)
    }
    @Test fun advertisedOversizeDoesNotReadAnyBody() {
        val forbidden = object : InputStream() { override fun read(): Int = error("BODY_MUST_NOT_BE_READ") }
        assertThrows(IllegalArgumentException::class.java) { readRepositoryBody(forbidden, 1001, 1000) }
    }
    @Test fun anInaccurateContentLengthCannotBypassTheLimit() {
        assertThrows(IllegalArgumentException::class.java) {
            readRepositoryBody(ByteArrayInputStream(ByteArray(1025)), 1, 1024)
        }
    }
    @Test fun exactLimitAndEmptyBodiesPreserveBytes() {
        val bytes = ByteArray(8192) { (it % 255).toByte() }
        assertArrayEquals(bytes, readRepositoryBody(ByteArrayInputStream(bytes), -1, bytes.size))
        assertArrayEquals(byteArrayOf(), readRepositoryBody(ByteArrayInputStream(byteArrayOf()), 0, 1))
    }
}
