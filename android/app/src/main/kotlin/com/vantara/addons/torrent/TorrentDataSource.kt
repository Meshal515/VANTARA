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
    /**
     * مخزن القراءات الصغيرة. مستخرج MKV في Media3 يقرأ فهرس Cues عنصرًا عنصرًا (بايت للمعرّف، بايت للحجم، بضعة للقيمة)،
     * و[DefaultExtractorInput] لا يخزّن: كل واحدة استدعاء read هنا. نقطة الفهرس ~15 بايت بعشرة استدعاءات، و519KB نحو
     * 350 ألف استدعاء، وكل استدعاء في المحرك (Lease.read: prioritize تحت القفل، havePiece متزامن من libtorrent، القرص)
     * ~40µs: 14–16 ث ثابتة على المحاكي ولو كان الملف على القرص (TorrentSeekDeviceTest، 27 نوفمبر)، و23–35KB/s على جهاز
     * المالك (أول قفزة بعد البدء بلا فهرس 14.8 ث، المتابعة 28.5 ث). القراءة الصغيرة تجلب [CHUNK] من المحرك مرة، وما بعدها
     * من هنا بلا قفل ولا libtorrent. المحرك يعيد ما هو متاح الآن (قد يكون أقل)، فلا انتظار زائد.
     */
    private var chunk: ByteArray? = null
    private var chunkAt = 0L
    private var chunkLength = 0
    override fun open(dataSpec: DataSpec): Long {
        chunkLength = 0
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
        val held = chunk
        if (held != null && chunkLength > 0 && position >= chunkAt && position < chunkAt + chunkLength) {
            val n = minOf(want.toLong(), chunkAt + chunkLength - position).toInt()
            System.arraycopy(held, (position - chunkAt).toInt(), buffer, offset, n)
            return delivered(n)
        }
        // لا يعبر المخزن إلى مرفقات MKV (تُعطى أصفارًا بلا تنزيل في Lease.read من بدايتها)
        val size = minOf(CHUNK.toLong(), remaining, reader.unskipped(position)).toInt()
        if (want >= size) return reader.read(position, buffer, offset, want).also { if (it > 0) delivered(it) }
        val target = held ?: ByteArray(CHUNK).also { chunk = it }
        val got = reader.read(position, target, 0, size)
        if (got <= 0) return got
        chunkAt = position; chunkLength = got
        val n = minOf(want, got)
        System.arraycopy(target, 0, buffer, offset, n)
        return delivered(n)
    }
    private fun delivered(count: Int): Int {
        position += count; remaining -= count; bytesTransferred(count)
        return count
    }
    override fun getUri(): Uri? = current
    override fun close() {
        cancelled = true
        chunkLength = 0
        lease?.close(); lease = null; current = null
        if (started) { started = false; transferEnded() }
    }
    companion object {
        /** كتلة واحدة من المحرك تكفي آلاف قراءات الفهرس الصغيرة. */
        const val CHUNK = 64 * 1024
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
