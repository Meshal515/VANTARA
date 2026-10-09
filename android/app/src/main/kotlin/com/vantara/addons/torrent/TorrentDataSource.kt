package com.vantara.addons.torrent

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.io.IOException

/** Progressive Media3 source. Every seek opens another bounded byte range, not another video prepare. */
internal class TorrentDataSource(private val engine: TorrentEngine) : BaseDataSource(true) {
    @Volatile private var cancelled = false
    @Volatile private var lease: TorrentEngine.Lease? = null
    private var current: Uri? = null
    private var position = 0L
    private var remaining = 0L
    private var started = false
    override fun open(dataSpec: DataSpec): Long {
        if (cancelled) throw IOException("Torrent reader already closed")
        current = dataSpec.uri
        transferInitializing(dataSpec)
        val acquired = engine.acquire(dataSpec.uri) { cancelled }
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
        val count = reader.read(position, buffer, offset, minOf(length.toLong(), remaining).toInt())
        if (count > 0) { position += count; remaining -= count; bytesTransferred(count) }
        return count
    }
    override fun getUri(): Uri? = current
    override fun close() {
        cancelled = true
        lease?.close(); lease = null; current = null
        if (started) { started = false; transferEnded() }
    }
    class Factory(private val engine: TorrentEngine, private val delegate: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = object : DataSource {
            private val listeners = ArrayList<TransferListener>()
            @Volatile private var active: DataSource? = null
            override fun addTransferListener(listener: TransferListener) { listeners.add(listener); active?.addTransferListener(listener) }
            override fun open(dataSpec: DataSpec): Long {
                val source = if (dataSpec.uri.scheme == TorrentEngine.SCHEME) TorrentDataSource(engine) else delegate.createDataSource()
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
