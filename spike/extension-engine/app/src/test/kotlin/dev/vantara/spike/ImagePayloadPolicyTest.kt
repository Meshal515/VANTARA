package dev.vantara.spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImagePayloadPolicyTest {

    @Test
    fun `large html response is rejected instead of reported as an image`() {
        val html = ("<html>blocked</html>".repeat(100)).encodeToByteArray()

        val verdict = ImagePayloadPolicy.validate("text/html; charset=UTF-8", html)

        assertFalse(verdict.accepted)
        assertEquals("content-type text/html; charset=UTF-8 is not an image", verdict.reason)
    }

    @Test
    fun `html masquerading as image mime is rejected by signature`() {
        val html = ("<!doctype html><title>challenge</title>".repeat(40)).encodeToByteArray()

        val verdict = ImagePayloadPolicy.validate("image/jpeg", html)

        assertFalse(verdict.accepted)
        assertEquals("payload signature is not a supported image", verdict.reason)
    }

    @Test
    fun `jpeg signature is accepted without a mime header`() {
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()) +
            ByteArray(2048)

        assertTrue(ImagePayloadPolicy.validate(null, jpeg).accepted)
    }

    @Test
    fun `preview sampling bounds a very tall manga page`() {
        assertEquals(32, ImagePayloadPolicy.sampleSize(4_000, 12_000, 320, 480))
        assertEquals(1, ImagePayloadPolicy.sampleSize(240, 400, 320, 480))
    }
}
