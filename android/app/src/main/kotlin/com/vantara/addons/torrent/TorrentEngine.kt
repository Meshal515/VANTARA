package com.vantara.addons.torrent

import android.content.Context
import android.net.Uri
import android.system.Os
import androidx.media3.datasource.DataSource
import com.frostwire.jlibtorrent.*
import com.frostwire.jlibtorrent.alerts.*
import com.frostwire.jlibtorrent.swig.ip_filter
import com.frostwire.jlibtorrent.swig.settings_pack
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** One native session; requests only register tickets. Network/metadata/pieces run on Media3's loader. */
class TorrentEngine internal constructor(context: Context, private val networkFilter: () -> ip_filter = ::publicNetworkFilter) : AutoCloseable {
    private val directory = File(context.cacheDir, "torrent-streams").apply { mkdirs() }
    private val shutdown = AtomicBoolean(false)
    private data class Ticket(val request: TorrentRequest, @Volatile var touched: Long = System.currentTimeMillis())
    private val tickets = ConcurrentHashMap<String, Ticket>()
    private val states = ConcurrentHashMap<String, State>()
    private val managerHolder = lazy {
        check(nativeAvailable()) { "Native torrent library unavailable on device ABI" }
        SessionManager(false).apply {
            addListener(object : AlertListener {
                override fun types() = intArrayOf(AlertType.READ_PIECE.swig())
                override fun alert(alert: Alert<*>) {
                    if (alert !is ReadPieceAlert) return
                    val hash = alert.handle().infoHash().toHex()
                    val state = states[hash] ?: return
                    if (!state.reading(alert.piece())) return
                    if (alert.error().value() != 0) state.readFailed(alert.piece())
                    else if (alert.size() in 1..MAX_PIECE_BYTES) {
                        runCatching { NativePieceBytes.copy(alert.bufferPtr(), alert.size()) }
                            .onSuccess { state.received(alert.piece(), it) }
                            .onFailure { state.readFailed(alert.piece()) }
                    } else state.readFailed(alert.piece())
                }
            })
            val settings = SettingsPack().connectionsLimit(96).activeDownloads(2).activeSeeds(0).activeLimit(2)
                .maxPeerlistSize(1000).uploadRateLimit(128 * 1024).maxQueuedDiskBytes(8 * 1024 * 1024)
                .validateHttpsTrackers(true).stopTrackerTimeout(1)
            settings.setEnableLsd(false)
            settings.setBoolean(settings_pack.bool_types.ssrf_mitigation.swigValue(), true)
            settings.setBoolean(settings_pack.bool_types.apply_ip_filter_to_trackers.swigValue(), true)
            start(SessionParams(settings))
            // Addons cannot turn trackers/peers into requests to local services.
            swig().set_ip_filter(networkFilter())
        }
    }
    private val manager: SessionManager get() = managerHolder.value
    private val pruner = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "VantaraTorrentPrune").apply { isDaemon = true } }
    init { pruner.scheduleWithFixedDelay({ runCatching { prune() } }, 1, 1, TimeUnit.MINUTES) }
    /** Process/test shutdown on a worker thread. Ordinary player close releases only its reader. */
    override fun close() {
        if (!shutdown.compareAndSet(false, true)) return
        pruner.shutdownNow(); tickets.clear()
        val active = synchronized(states) { states.values.toList().also { states.clear() } }
        active.forEach { it.remove() }
        if (managerHolder.isInitialized()) manager.stop()
    }
    /** Never starts a download or prepares/plays a video. */
    fun register(request: TorrentRequest): Uri {
        check(!shutdown.get()) { "Torrent engine is closed" }
        pruneTickets()
        require(tickets.size < MAX_TICKETS) { "Too many pending torrent choices" }
        val token = UUID.randomUUID().toString()
        tickets[token] = Ticket(request)
        return Uri.Builder().scheme(SCHEME).authority(token).path("/file").build()
    }
    fun release(uri: Uri) { uri.host?.let(tickets::remove) }
    fun dataSourceFactory(delegate: DataSource.Factory): DataSource.Factory = TorrentDataSource.Factory(this, delegate)

    internal fun acquire(uri: Uri, cancelled: () -> Boolean): Lease {
        if (uri.scheme != SCHEME || uri.path != "/file") throw IOException("Invalid torrent playback ticket")
        val ticket = tickets[uri.host] ?: throw IOException("Torrent playback ticket expired")
        ticket.touched = System.currentTimeMillis()
        val stopped = { shutdown.get() || cancelled() }
        checkCancelled(stopped)
        val request = ticket.request
        val state = synchronized(states) {
            if (states[request.infoHash]?.unused() != false && states.values.count { !it.unused() } >= MAX_ACTIVE_STATES) throw IOException("Too many active torrent readers")
            if (!states.containsKey(request.infoHash) && states.size >= MAX_RESIDENT_STATES) {
                val oldest = states.entries.filter { it.value.unused() }.minByOrNull { it.value.idleAt }
                if (oldest != null && states.remove(oldest.key, oldest.value)) oldest.value.remove()
            }
            states.computeIfAbsent(request.infoHash) { State(request.infoHash) }.also { it.retain() }
        }
        return try {
            val handle = state.handle(stopped, request)
            val info = waitFor(stopped, METADATA_TIMEOUT_MS, "Torrent metadata unavailable") { handle.torrentFile()?.takeIf { it.isValid } }
            val storage = info.files()
            if (info.pieceLength() !in 1..MAX_PIECE_BYTES || info.numPieces() > 1_000_000 || storage.numFiles() > 100_000) throw IOException("Torrent metadata exceeds safe streaming limits")
            val files = (0 until storage.numFiles()).filterNot { storage.padFileAt(it) }.map {
                TorrentFile(it, storage.filePath(it), storage.fileSize(it), storage.fileOffset(it))
            }
            val selected = try { TorrentPolicy.selectFile(files, request.fileIdx) } catch (_: IllegalArgumentException) { throw IOException("Requested torrent file is not a playable video") }
            // Reject escaping paths anywhere in the pack, not just the chosen video.
            for (index in 0 until storage.numFiles()) {
                val target = File(state.folder, storage.filePath(index)).canonicalFile
                if (!target.path.startsWith(state.folder.canonicalPath + File.separator) || storage.fileAbsolutePath(index) || storage.fileFlags(index).and_(FileStorage.FLAG_SYMLINK).nonZero()) throw IOException("Unsafe torrent file path")
            }
            state.select(handle, selected, info)
            handle.unsetFlags(TorrentFlags.AUTO_MANAGED)
            handle.unsetFlags(TorrentFlags.STOP_WHEN_READY)
            handle.resume()
            Lease(state, selected, info.pieceLength(), stopped)
        } catch (error: Throwable) {
            state.drop()
            if (error is IOException) throw error
            throw IOException("Native torrent preparation failed", error)
        }
    }
    internal inner class Lease(private val state: State, val file: TorrentFile, val pieceLength: Int, private val cancelled: () -> Boolean) {
        private val closed = AtomicBoolean(false)
        fun read(position: Long, target: ByteArray, offset: Int, count: Int): Int {
            if (closed.get()) throw InterruptedIOException("Torrent reader closed")
            val plan = TorrentPolicy.readAt(file, position, pieceLength, count) ?: return -1
            state.prioritize(file, position, pieceLength)
            val bytes = state.piece(plan.piece) { closed.get() || cancelled() }
            if (plan.offset + plan.length > bytes.size) throw IOException("Verified piece shorter than selected file range")
            bytes.copyInto(target, offset, plan.offset, plan.offset + plan.length)
            return plan.length
        }
        fun close() { if (closed.compareAndSet(false, true)) state.drop() }
    }
    internal inner class State(private val hash: String) {
        val folder = File(File(directory, hash), "payload").apply { mkdirs() }
        private val monitor = Object()
        private var refs = 0
        private var initialized = false
        private var starting = false
        private var selected: Int? = null
        private var torrent: TorrentHandle? = null
        private var window = emptyList<Int>()
        private val pieces = LinkedHashMap<Int, ByteArray>(8, 0.75f, true)
        private val reading = HashSet<Int>()
        private val failed = HashSet<Int>()
        private var memoryBytes = 0
        @Volatile var idleAt = System.currentTimeMillis(); private set
        fun retain() = synchronized(monitor) { refs++; idleAt = Long.MAX_VALUE }
        fun drop() = synchronized(monitor) {
            if (refs > 0) refs--
            if (refs == 0) {
                idleAt = System.currentTimeMillis()
                torrent?.takeIf { it.isValid }?.let { handle ->
                    handle.pause(); handle.clearPieceDeadlines()
                    window.forEach { handle.piecePriority(it, Priority.IGNORE) }
                }
                window = emptyList()
                pieces.clear(); reading.clear(); failed.clear(); memoryBytes = 0
            }
            monitor.notifyAll()
        }
        fun unused() = synchronized(monitor) { refs == 0 }
        fun handle(cancelled: () -> Boolean, request: TorrentRequest): TorrentHandle {
            synchronized(monitor) {
                torrent?.takeIf { it.isValid }?.let { addTrackers(it, request); return it }
                if (!starting) {
                    starting = true
                    val cached = File(folder.parentFile, "metadata.torrent")
                    val info = runCatching { if (cached.isFile && cached.length() <= 2 * 1024 * 1024) TorrentInfo(cached).takeIf { it.infoHashV1().toHex() == hash } else null }.getOrNull()
                    if (info != null) {
                        val known = info.trackers().map { it.url() }.toSet()
                        request.trackers.filterNot { it in known }.forEach { info.addTracker(it) }
                        manager.download(info, folder, null, Priority.array(Priority.IGNORE, info.numFiles()), null, TorrentFlags.STOP_WHEN_READY)
                    } else manager.download(request.magnetUri(), folder, TorrentFlags.STOP_WHEN_READY)
                }
            }
            val found = waitFor(cancelled, METADATA_TIMEOUT_MS, "Torrent session unavailable") { manager.find(Sha1Hash(hash))?.takeIf { it.isValid } }
            synchronized(monitor) { torrent = found; addTrackers(found, request) }
            return found
        }
        private fun addTrackers(handle: TorrentHandle, request: TorrentRequest) {
            val known = handle.trackers().map { it.url() }.toSet()
            request.trackers.filterNot { it in known }.forEach { handle.addTracker(AnnounceEntry(it)) }
        }
        fun select(handle: TorrentHandle, file: TorrentFile, info: TorrentInfo) = synchronized(monitor) {
            if (selected != null && selected != file.index && refs > 1) throw IOException("Another file from this torrent is already playing")
            if (!initialized || selected != file.index) {
                handle.prioritizePieces(Priority.array(Priority.IGNORE, info.numPieces()))
                selected = file.index; initialized = true; window = emptyList()
                val metadata = File(folder.parentFile, "metadata.torrent")
                if (!metadata.isFile) runCatching { metadata.writeBytes(info.bencode()) }
            }
        }
        fun prioritize(file: TorrentFile, position: Long, pieceLength: Int) = synchronized(monitor) {
            val next = TorrentPolicy.window(file, position, pieceLength)
            if (next == window) return@synchronized
            if (directory.usableSpace < MIN_FREE_BYTES || allocatedBytes(folder) > MAX_ACTIVE_BYTES) throw IOException("Insufficient torrent cache space")
            val handle = torrent ?: throw IOException("Torrent session ended")
            handle.clearPieceDeadlines()
            window.filterNot { it in next }.forEach { handle.piecePriority(it, Priority.IGNORE) }
            next.forEachIndexed { index, piece ->
                handle.piecePriority(piece, if (index == 0) Priority.SEVEN else Priority.SIX)
                handle.setPieceDeadline(piece, index * 200)
            }
            window = next
        }
        fun piece(piece: Int, cancelled: () -> Boolean): ByteArray {
            val start = System.nanoTime()
            synchronized(monitor) {
                while (true) {
                    checkCancelled(cancelled)
                    pieces[piece]?.let { return it }
                    if (refs == 0) throw InterruptedIOException("Torrent has no active reader")
                    if (failed.remove(piece)) throw IOException("Torrent piece read failed")
                    val handle = torrent ?: throw IOException("Torrent session ended")
                    if (handle.status().errorCode().value() != 0) throw IOException("Torrent host/download failure")
                    if (handle.havePiece(piece) && reading.add(piece)) handle.readPiece(piece)
                    if (TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) >= PIECE_TIMEOUT_MS) {
                        reading.remove(piece)
                        throw IOException("Torrent buffer timed out; try another source")
                    }
                    try { monitor.wait(100) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); throw InterruptedIOException("Torrent read interrupted") }
                }
            }
        }
        fun reading(piece: Int): Boolean = synchronized(monitor) { piece in reading }
        fun received(piece: Int, bytes: ByteArray) = synchronized(monitor) {
            if (!reading.remove(piece)) return@synchronized
            while (pieces.isNotEmpty() && memoryBytes + bytes.size > MAX_MEMORY_BYTES) {
                val first = pieces.entries.first(); memoryBytes -= first.value.size; pieces.remove(first.key)
            }
            pieces.put(piece, bytes)?.let { memoryBytes -= it.size }; memoryBytes += bytes.size
            monitor.notifyAll()
        }
        fun readFailed(piece: Int) = synchronized(monitor) { reading.remove(piece); failed.add(piece); monitor.notifyAll() }
        fun remove() = synchronized(monitor) {
            torrent?.takeIf { it.isValid }?.let { manager.remove(it) }
            torrent = null; pieces.clear(); reading.clear(); failed.clear(); memoryBytes = 0
            monitor.notifyAll()
        }
    }
    private fun pruneTickets() {
        val cutoff = System.currentTimeMillis() - TICKET_TTL_MS
        tickets.entries.removeIf { it.value.touched < cutoff && states[it.value.request.infoHash]?.unused() != false }
    }
    private fun prune() {
        pruneTickets()
        val cutoff = System.currentTimeMillis() - IDLE_TTL_MS
        val expired = synchronized(states) {
            states.entries.filter { it.value.unused() && it.value.idleAt < cutoff }.mapNotNull { (hash, state) ->
                if (states.remove(hash, state)) state else null
            }
        }
        expired.forEach { it.remove() }
        synchronized(states) {
            val folders = directory.listFiles()?.filter { it.isDirectory && !states.containsKey(it.name) }?.sortedBy { it.lastModified() }.orEmpty()
            var bytes = folders.sumOf(::allocatedBytes)
            for (folder in folders) if (bytes > MAX_IDLE_BYTES) { val size = allocatedBytes(folder); if (folder.deleteRecursively()) bytes -= size }
        }
    }
    private fun allocatedBytes(folder: File): Long = folder.walkTopDown().filter { it.isFile }.sumOf { runCatching { Os.stat(it.path).st_blocks * 512L }.getOrDefault(it.length()) }
    companion object {
        const val SCHEME = "vantara-torrent"
        private const val MAX_PIECE_BYTES = 16 * 1024 * 1024
        private const val MAX_MEMORY_BYTES = 32 * 1024 * 1024
        private const val MAX_ACTIVE_BYTES = 8L * 1024 * 1024 * 1024
        private const val MAX_IDLE_BYTES = 1024L * 1024 * 1024
        private const val MIN_FREE_BYTES = 256L * 1024 * 1024
        private const val MAX_TICKETS = 512
        private const val MAX_ACTIVE_STATES = 2
        private const val MAX_RESIDENT_STATES = 6
        private const val TICKET_TTL_MS = 30L * 60 * 1000
        private const val IDLE_TTL_MS = 60_000L
        private const val METADATA_TIMEOUT_MS = 45_000L
        private const val PIECE_TIMEOUT_MS = 30_000L
        private val PRIVATE_RANGES = listOf(
            "0.0.0.0" to "0.255.255.255", "10.0.0.0" to "10.255.255.255", "100.64.0.0" to "100.127.255.255",
            "127.0.0.0" to "127.255.255.255", "169.254.0.0" to "169.254.255.255", "172.16.0.0" to "172.31.255.255",
            "192.168.0.0" to "192.168.255.255", "224.0.0.0" to "255.255.255.255", "::" to "::1",
            "fc00::" to "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "fe80::" to "feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
            "ff00::" to "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"
        )
        private fun publicNetworkFilter(): ip_filter = ip_filter().apply {
            for ((low, high) in PRIVATE_RANGES) add_rule(Address(low).swig(), Address(high).swig(), 1)
        }
        @Volatile private var instance: TorrentEngine? = null
        fun get(context: Context): TorrentEngine = instance ?: synchronized(this) { instance ?: TorrentEngine(context.applicationContext).also { instance = it } }
        private val loaded: Boolean by lazy { runCatching { LibTorrent.version(); NativePieceBytes.available() }.getOrDefault(false) }
        fun nativeAvailable(): Boolean = loaded
        private fun checkCancelled(cancelled: () -> Boolean) {
            if (cancelled() || Thread.currentThread().isInterrupted) throw InterruptedIOException("Torrent request cancelled")
        }
        private fun <T : Any> waitFor(cancelled: () -> Boolean, timeout: Long, message: String, get: () -> T?): T {
            val start = System.nanoTime()
            while (true) {
                checkCancelled(cancelled)
                get()?.let { return it }
                if (TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) >= timeout) throw IOException(message)
                try { Thread.sleep(100) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); throw InterruptedIOException("Torrent metadata interrupted") }
            }
        }
    }
}
