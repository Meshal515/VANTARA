package com.vantara.plugins

import dev.vantara.spike.ImagePayloadPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * صور الصفحات كما تصل من مضيفات حقيقية: الحكم للبايتات لا للترويسة ولا للحجم (تدقيق تنزيل المانجا، 15 نوفمبر).
 */
class ImagePayloadPolicyAppTest {
    private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()) + ByteArray(4096) + byteArrayOf(0xFF.toByte(), 0xD9.toByte())
    private val tinyPng = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) + ByteArray(300)
    private val webp = "RIFF".encodeToByteArray() + byteArrayOf(0, 1, 0, 0) + "WEBPVP8 ".encodeToByteArray() + ByteArray(256)

    @Test
    fun `a real image sent with a non-image content type is accepted`() {
        for (type in listOf("binary/octet-stream", "text/plain", "application/x-octet-stream", "application/force-download")) {
            assertTrue(type, ImagePayloadPolicy.validate(type, jpeg).accepted)
        }
    }

    @Test
    fun `a blank separator page under one kilobyte is a valid page`() {
        assertTrue(ImagePayloadPolicy.validate("image/png", tinyPng).accepted)
    }

    @Test
    fun `a block or challenge page is rejected whatever its headers say`() {
        val html = "<!doctype html><title>Just a moment...</title>".repeat(60).encodeToByteArray()
        assertFalse(ImagePayloadPolicy.validate("image/jpeg", html).accepted)
        assertEquals("content-type text/html is not an image", ImagePayloadPolicy.validate("text/html", html).reason)
    }

    @Test
    fun `type comes from the bytes so a webp named jpg is served as webp`() {
        assertEquals("image/webp", ImagePayloadPolicy.sniffType(webp))
        assertEquals("image/jpeg", ImagePayloadPolicy.sniffType(jpeg))
        assertEquals("image/png", ImagePayloadPolicy.sniffType(tinyPng))
        assertNull(ImagePayloadPolicy.sniffType("<html>".encodeToByteArray()))
    }
}
