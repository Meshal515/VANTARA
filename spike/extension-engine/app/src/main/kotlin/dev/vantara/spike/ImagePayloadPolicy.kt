package dev.vantara.spike

/** Cheap validation before Android allocates a bitmap for an untrusted response body. */
object ImagePayloadPolicy {

    data class Verdict(val accepted: Boolean, val reason: String? = null)

    fun validate(contentType: String?, bytes: ByteArray): Verdict {
        val normalizedType = contentType?.substringBefore(';')?.trim()?.lowercase()
        if (
            normalizedType != null &&
            normalizedType != "application/octet-stream" &&
            !normalizedType.startsWith("image/")
        ) {
            return Verdict(false, "content-type $contentType is not an image")
        }
        if (!hasSupportedSignature(bytes)) {
            return Verdict(false, "payload signature is not a supported image")
        }
        return Verdict(true)
    }

    /** Power-of-two sampling that keeps even very tall comic pages inside a small preview budget. */
    fun sampleSize(width: Int, height: Int, maxWidth: Int, maxHeight: Int): Int {
        if (width <= 0 || height <= 0 || maxWidth <= 0 || maxHeight <= 0) return 1
        var sample = 1
        while (width / sample > maxWidth || height / sample > maxHeight) {
            if (sample >= 1 shl 29) break
            sample *= 2
        }
        return sample
    }

    private fun hasSupportedSignature(bytes: ByteArray): Boolean {
        if (bytes.size < 12) return false
        val png = bytes.startsWith(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
        val jpeg = bytes.startsWith(0xFF, 0xD8, 0xFF)
        val gif = bytes.startsWithAscii("GIF87a") || bytes.startsWithAscii("GIF89a")
        val webp = bytes.startsWithAscii("RIFF") && bytes.asciiAt(8, 4) == "WEBP"
        val isoBrand = bytes.asciiAt(4, 4) == "ftyp" &&
            bytes.asciiAt(8, 4) in setOf("avif", "avis", "heic", "heix", "mif1")
        return png || jpeg || gif || webp || isoBrand
    }

    private fun ByteArray.startsWith(vararg expected: Int): Boolean =
        size >= expected.size && expected.indices.all { (this[it].toInt() and 0xFF) == expected[it] }

    private fun ByteArray.startsWithAscii(expected: String): Boolean = asciiAt(0, expected.length) == expected

    private fun ByteArray.asciiAt(offset: Int, length: Int): String? {
        if (offset < 0 || length < 0 || size < offset + length) return null
        return String(this, offset, length, Charsets.US_ASCII)
    }
}
