package com.vantara.addons.torrent

import com.frostwire.jlibtorrent.TorrentHandle

/**
 * تلميح القراءة (تعديل libtorrent 0004): القارئ [reader] ينتظر البايت [offset] من القطعة [piece]. libtorrent يطلب كتلها من
 * موضعه لا من أول القطعة، ويُنقذ أول كتل الموضع من المشاركين البطيئين كل دورة، فورًا عند البدء والقفز. يحتاجه الخيار B
 * ([TurboRead]): حلقة حزمة الموسم تبدأ داخل قطعة يشاركها ملف سابق، وفهرس MKV في آخر القطعة الأخيرة.
 *
 * الدالتان داخل libjlibtorrent.so المخصصة نفسها (tools/libtorrent-patches/vantara-jni.cpp). مكتبة بلاهما (jlibtorrent
 * الأصلية أو p1): يتعطل التلميح بهدوء من أول استدعاء، والتشغيل كما كان.
 */
internal object NativeReadHint {
    @Volatile private var available = TorrentEngine.PATCHED

    fun set(handle: TorrentHandle, reader: Int, piece: Int, offset: Int): Boolean {
        if (!available) return false
        return try { set0(handle.swig(), reader, piece, offset) } catch (_: UnsatisfiedLinkError) { available = false; false }
    }

    fun clear(handle: TorrentHandle, reader: Int) {
        if (!available) return
        try { clear0(handle.swig(), reader) } catch (_: UnsatisfiedLinkError) { available = false }
    }

    @JvmStatic private external fun set0(handle: Any, reader: Int, piece: Int, offset: Int): Boolean
    @JvmStatic private external fun clear0(handle: Any, reader: Int)
}
