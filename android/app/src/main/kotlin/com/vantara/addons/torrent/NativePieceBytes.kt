package com.vantara.addons.torrent

/** Alert buffers expire on return. Copy synchronously; never retain the native address. */
internal object NativePieceBytes {
    init { System.loadLibrary("vantara_torrent_bytes") }
    @JvmStatic external fun copy(address: Long, length: Int): ByteArray
    fun available() = true
}
