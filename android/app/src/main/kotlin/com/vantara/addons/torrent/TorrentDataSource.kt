package com.vantara.addons.torrent

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.io.IOException

/** Progressive Media3 source. Every seek opens another bounded byte range, not another video prepare. */
internal class TorrentDataSource(private val engine: TorrentEngine, private val preview: Boolean = false) : BaseDataSource(true) {
    @Volatile private var cancelled = false
    @Volatile private var lease: TorrentEngine.Lease? = null
    private var current: Uri? = null
    private var position = 0L
    private var remaining = 0L
    private var started = false
    /** القراءات الصغيرة من المخزن ([ReadChunk]: لماذا وشروطه)، والكبيرة من المحرك مباشرة. */
    private val chunk = ReadChunk(CHUNK)
    override fun open(dataSpec: DataSpec): Long {
        chunk.reset()
        if (cancelled) throw IOException("Torrent reader already closed")
        current = dataSpec.uri
        transferInitializing(dataSpec)
        val acquired = if (preview) engine.acquirePreview(dataSpec.uri) { cancelled } else engine.acquire(dataSpec.uri) { cancelled }
        lease = acquired
        if (cancelled) { acquired.close(); lease = null; throw IOException("Torrent reader closed") }
        if (dataSpec.position > acquired.file.size) { close(); throw IOException("Torrent seek exceeds video size") }
        position = dataSpec.position
        remaining = if (dataSpec.length == C.LENGTH_UNSET.toLong()) acquired.file.size - position else minOf(dataSpec.length, acquired.file.size - position)
        started = true
        transferStarted(dataSpec)
        return remaining
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining == 0L) return C.RESULT_END_OF_INPUT
        val reader = lease ?: throw IOException("Torrent reader is not open")
        val want = minOf(length.toLong(), remaining).toInt()
        val held = if (chunking) chunk.take(position, buffer, offset, want, reader.trustGeneration()) else -1
        if (held > 0) return delivered(held)
        // لا يعبر المخزن نطاق الطلب ولا مرفقات MKV (تُعطى أصفارًا بلا تنزيل في Lease.read من بدايتها)
        val size = minOf(CHUNK.toLong(), remaining, reader.unskipped(position)).toInt()
        if (!chunking || want >= size) return reader.read(position, buffer, offset, want).also { if (it > 0) delivered(it) }
        val trust = reader.trustGeneration()
        val got = chunk.fill(position, size, trust, { b, o, n -> reader.read(position, b, o, n) }) { reader.lastEarly }
        if (got <= 0) return got
        // فشل تحقق أثناء الجلب نفسه: الجيل تغيّر فيُرمى ويُطلب موثقًا
        val n = chunk.take(position, buffer, offset, want, reader.trustGeneration())
        return if (n > 0) delivered(n) else reader.read(position, buffer, offset, want).also { if (it > 0) delivered(it) }
    }
    private fun delivered(count: Int): Int {
        position += count; remaining -= count; bytesTransferred(count)
        return count
    }
    override fun getUri(): Uri? = current
    override fun close() {
        cancelled = true
        chunk.reset()
        lease?.close(); lease = null; current = null
        if (started) { started = false; transferEnded() }
    }
    companion object {
        /** كتلة واحدة من المحرك تكفي آلاف قراءات الفهرس الصغيرة. */
        const val CHUNK = 64 * 1024
        /** للاختبار على الجهاز فقط: قياس قبل وبعد في التشغيل نفسه (false = كل read إلى المحرك كما قبل المخزن). */
        @androidx.annotation.VisibleForTesting
        @Volatile internal var chunking = true
    }
    class Factory(private val engine: TorrentEngine, private val delegate: DataSource.Factory, private val preview: Boolean = false) : DataSource.Factory {
        override fun createDataSource(): DataSource = object : DataSource {
            private val listeners = ArrayList<TransferListener>()
            @Volatile private var active: DataSource? = null
            override fun addTransferListener(listener: TransferListener) { listeners.add(listener); active?.addTransferListener(listener) }
            override fun open(dataSpec: DataSpec): Long {
                val source = if (dataSpec.uri.scheme == TorrentEngine.SCHEME) TorrentDataSource(engine, preview) else delegate.createDataSource()
                active = source
                listeners.forEach(source::addTransferListener)
                return source.open(dataSpec)
            }
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int = active?.read(buffer, offset, length) ?: throw IOException("Media source is not open")
            override fun getUri(): Uri? = active?.uri
            override fun getResponseHeaders(): Map<String, List<String>> = active?.responseHeaders.orEmpty()
            override fun close() { active?.close(); active = null }
        }
    }
}
