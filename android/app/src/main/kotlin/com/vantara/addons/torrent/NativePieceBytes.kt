package com.vantara.addons.torrent

/** Alert buffers expire on return. Copy synchronously; never retain the native address. */
internal object NativePieceBytes {
    init { System.loadLibrary("vantara_torrent_bytes") }
    @JvmStatic external fun copy(address: Long, length: Int): ByteArray
    /** يحرّر [length] بايت من [path] بدءًا من [offset] (FALLOC_FL_PUNCH_HOLE)؛ الحجم المنطقي باقٍ. */
    @JvmStatic external fun punch(path: String, offset: Long, length: Long): Boolean
    fun available() = true
}
