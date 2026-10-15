package com.vantara.addons.torrent

import android.content.Context
import android.net.Uri
import android.system.Os
import androidx.media3.datasource.DataSource
import com.frostwire.jlibtorrent.*
import com.frostwire.jlibtorrent.alerts.*
import com.frostwire.jlibtorrent.swig.add_torrent_params
import com.frostwire.jlibtorrent.swig.error_code
import com.frostwire.jlibtorrent.swig.ip_filter
import com.frostwire.jlibtorrent.swig.torrent_handle
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
    /** Routing-table size: 0 for a long time means the device cannot reach the BitTorrent network at all. */
    fun dhtNodes(): Long = if (managerHolder.isInitialized()) runCatching { manager.dhtNodes() }.getOrDefault(0L) else 0L
    /** Live swarm facts for a ticket: what Stremio shows while buffering. Null before the session exists. */
    fun stats(uri: Uri): TorrentStats? {
        val hash = uri.host?.let(tickets::get)?.request?.infoHash ?: return null
        if (!managerHolder.isInitialized()) return null
        val handle = manager.find(Sha1Hash(hash))?.takeIf { it.isValid } ?: return null
        val status = runCatching { handle.status() }.getOrNull() ?: return null
        val flags = runCatching { handle.flags() }.getOrNull()
        return TorrentStats(status.numPeers(), status.numSeeds(), status.downloadPayloadRate().toLong(), status.totalDone(), handle.torrentFile()?.isValid == true,
            state = status.state().name, paused = flags?.and_(TorrentFlags.PAUSED)?.nonZero() == true, candidates = status.connectCandidates(), known = status.listPeers())
    }
    fun dataSourceFactory(delegate: DataSource.Factory): DataSource.Factory = TorrentDataSource.Factory(this, delegate)
    /**
     * موضع المشاهدة من المشغّل (كل بضع ثوانٍ): يحرّك النافذة على القرص — يفرّغ ما خلف آخر
     * 50 ثانية ويحدد كم يُنزَّل قدّام حسب المساحة الحرة.
     */
    fun playback(uri: Uri, positionMs: Long, durationMs: Long) {
        val hash = uri.host?.let(tickets::get)?.request?.infoHash ?: return
        val state = states[hash] ?: return
        // خارج خيط الواجهة: التفريغ قراءة/كتابة على القرص
        if (!shutdown.get()) runCatching { pruner.execute { runCatching { state.playback(positionMs, durationMs) } } }
    }

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
        // النافذة المتحركة: الملف المختار، القطع المطلوبة قدّام النافذة، والمدى المفرّغ من القرص
        private var file: TorrentFile? = null
        private var pieceLength = 0
        private var ahead = TorrentWindow.MIN_AHEAD_PIECES
        private var aheadRange = IntRange.EMPTY
        private var evictedFrom = Int.MAX_VALUE
        private var evictedUntil = 0
        private fun evicted(piece: Int) = piece in evictedFrom until evictedUntil
        private val pieces = LinkedHashMap<Int, ByteArray>(8, 0.75f, true)
        private val reading = HashSet<Int>()
        private val failed = HashSet<Int>()
        private var memoryBytes = 0
        @Volatile var idleAt = System.currentTimeMillis(); private set
        fun retain() = synchronized(monitor) { refs++; idleAt = Long.MAX_VALUE }
        /**
         * Media3 closes and reopens the reader on every extractor seek (MP4 moov / MKV cues / AVI idx1
         * live at the end of the file). Pausing here disconnected every peer on each reopen, so a real
         * swarm never got past the first seconds: a black screen that loads forever. The torrent now
         * stays connected for a short grace period and pauses only if nobody reopened it.
         */
        fun drop() = synchronized(monitor) {
            if (refs > 0) refs--
            if (refs == 0) {
                val at = System.currentTimeMillis()
                idleAt = at
                reading.clear(); failed.clear()
                if (!shutdown.get()) runCatching { pruner.schedule({ pauseIfStillIdle(at) }, IDLE_GRACE_MS, TimeUnit.MILLISECONDS) }
            }
            monitor.notifyAll()
        }
        private fun pauseIfStillIdle(since: Long) = synchronized(monitor) {
            if (refs != 0 || idleAt != since) return@synchronized
            torrent?.takeIf { it.isValid }?.let { handle ->
                handle.pause(); handle.clearPieceDeadlines()
                window.forEach { handle.piecePriority(it, Priority.IGNORE) }
                aheadRange.forEach { handle.piecePriority(it, Priority.IGNORE) }
            }
            window = emptyList(); aheadRange = IntRange.EMPTY
            pieces.clear(); reading.clear(); failed.clear(); memoryBytes = 0
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
            // libtorrent adds a magnet PAUSED + AUTO_MANAGED by default, and acquire() only resumed it
            // after metadata — which a paused torrent never fetches. Live emulator proof: 120+ DHT nodes,
            // 4 popular swarms, 0 peers, "metadata unavailable". The player asked for it: start now.
            runCatching { found.unsetFlags(TorrentFlags.AUTO_MANAGED); found.resume() }
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
                // Container index lives at the head or the tail: fetch both before the extractor asks.
                for (piece in TorrentPolicy.edges(file, info.pieceLength())) handle.piecePriority(piece, Priority.SIX)
                selected = file.index; initialized = true; window = emptyList(); aheadRange = IntRange.EMPTY
                this.file = file; pieceLength = info.pieceLength()
                val metadata = File(folder.parentFile, "metadata.torrent")
                if (!metadata.isFile) runCatching { metadata.writeBytes(info.bencode()) }
            }
        }
        fun prioritize(file: TorrentFile, position: Long, pieceLength: Int) = synchronized(monitor) {
            val next = TorrentPolicy.window(file, position, pieceLength)
            // رجوع لمنطقة فُرّغت من القرص: libtorrent يقرأها أصفارًا، فنعيد البناء أولًا
            if (next.isNotEmpty() && evicted(next.first())) rebuild()
            if (next == window) return@synchronized
            if (directory.usableSpace < MIN_FREE_BYTES || allocatedBytes(folder) > MAX_ACTIVE_BYTES) throw IOException("Insufficient torrent cache space")
            val handle = torrent ?: throw IOException("Torrent session ended")
            handle.clearPieceDeadlines()
            window.filterNot { it in next }.forEach { handle.piecePriority(it, Priority.IGNORE) }
            next.forEachIndexed { index, piece ->
                handle.piecePriority(piece, if (index == 0) Priority.SEVEN else Priority.SIX)
                handle.setPieceDeadline(piece, index * 200)
            }
            extendAhead(handle, file, pieceLength, next)
            window = next
        }

        /** ما بعد النافذة حتى [ahead] قطعة: أولوية عادية بلا مواعيد، فيُنزَّل قدّام بقدر المساحة. */
        private fun extendAhead(handle: TorrentHandle, file: TorrentFile, pieceLength: Int, next: List<Int>) {
            if (next.isEmpty()) return
            val last = ((file.offset + file.size - 1) / pieceLength).toInt()
            val range = (next.last() + 1) until minOf(last + 1, next.first() + maxOf(ahead, next.size))
            for (p in aheadRange) if (p !in range && p !in next) handle.piecePriority(p, Priority.IGNORE)
            for (p in range) if (p !in aheadRange) handle.piecePriority(p, Priority.FOUR)
            aheadRange = range
        }

        fun playback(positionMs: Long, durationMs: Long) = synchronized(monitor) {
            val file = file ?: return@synchronized
            if (refs == 0 || pieceLength <= 0 || durationMs <= 0) return@synchronized
            ahead = TorrentWindow.aheadPieces(file, pieceLength, durationMs, directory.usableSpace)
            val keep = TorrentWindow.keepFrom(file, pieceLength, positionMs, durationMs) ?: return@synchronized
            // لا نقترب أبدًا مما يقرؤه المشغّل الآن
            val guard = window.firstOrNull()?.let { minOf(keep, it) } ?: keep
            val range = TorrentWindow.evictRange(file, pieceLength, guard, evictedUntil) ?: return@synchronized
            val (offset, length) = TorrentWindow.fileSpan(file, pieceLength, range)
            if (length <= 0) return@synchronized
            if (!runCatching { NativePieceBytes.punch(File(folder, file.path).path, offset, length) }.getOrDefault(false)) return@synchronized
            evictedFrom = minOf(evictedFrom, range.first); evictedUntil = range.last + 1
            for (p in range) pieces.remove(p)?.let { memoryBytes -= it.size }
        }

        /**
         * إعادة بناء بعد الرجوع لمنطقة مفرّغة: بيانات الاستئناف مع حذف القطع المفرّغة من «عندي»،
         * ثم إزالة التورنت (الملفات باقية) وإضافته بها — libtorrent يعرف بالضبط ما ينقصه ولا يفحص
         * الملف كاملًا. ثبت باختبار حقيقي على libtorrent 2.0.12.9: القطعة تعود صحيحة والباقي سليم.
         */
        private fun rebuild() {
            val old = torrent?.takeIf { it.isValid } ?: throw IOException("Torrent session ended")
            val params: add_torrent_params = runCatching { old.swig().get_resume_data(torrent_handle.save_info_dict) }.getOrNull()
                ?: throw IOException("Torrent rebuild failed")
            val have = params.get_have_pieces()
            for (p in evictedFrom until minOf(evictedUntil, have.size())) have.clear_bit(p)
            params.set_have_pieces(have)
            val verified = params.get_verified_pieces()
            if (verified.size() > 0) { for (p in evictedFrom until minOf(evictedUntil, verified.size())) verified.clear_bit(p); params.set_verified_pieces(verified) }
            manager.remove(old)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (manager.find(Sha1Hash(hash))?.isValid == true) {
                if (System.nanoTime() > deadline) throw IOException("Torrent rebuild timed out")
                try { Thread.sleep(20) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); throw InterruptedIOException("Torrent rebuild interrupted") }
            }
            val error = error_code()
            val added = manager.swig().add_torrent(params, error)
            if (error.value() != 0 || !added.is_valid) { torrent = null; throw IOException("Torrent rebuild failed") }
            val handle = TorrentHandle(added)
            handle.unsetFlags(TorrentFlags.AUTO_MANAGED)
            handle.unsetFlags(TorrentFlags.STOP_WHEN_READY)
            val info = handle.torrentFile()
            if (info != null && info.isValid) {
                handle.prioritizePieces(Priority.array(Priority.IGNORE, info.numPieces()))
                file?.let { f -> for (piece in TorrentPolicy.edges(f, info.pieceLength())) handle.piecePriority(piece, Priority.SIX) }
            }
            handle.resume()
            torrent = handle
            window = emptyList(); aheadRange = IntRange.EMPTY
            reading.clear(); failed.clear()
            for (p in evictedFrom until evictedUntil) pieces.remove(p)?.let { memoryBytes -= it.size }
            evictedFrom = Int.MAX_VALUE; evictedUntil = 0
        }
        fun piece(piece: Int, cancelled: () -> Boolean): ByteArray {
            val start = System.nanoTime()
            var progressAt = start
            var checkedAt = 0L
            var done = -1L
            synchronized(monitor) {
                while (true) {
                    checkCancelled(cancelled)
                    pieces[piece]?.let { return it }
                    if (refs == 0) throw InterruptedIOException("Torrent has no active reader")
                    if (evicted(piece)) rebuild()
                    if (failed.remove(piece)) throw IOException("Torrent piece read failed")
                    val handle = torrent ?: throw IOException("Torrent session ended")
                    if (handle.status().errorCode().value() != 0) throw IOException("Torrent host/download failure")
                    if (handle.havePiece(piece) && reading.add(piece)) handle.readPiece(piece)
                    // A 4K piece can be 16 MB: fail on a stalled swarm, not on a slow but moving one.
                    val now = System.nanoTime()
                    if (now - checkedAt >= ONE_SECOND_NS) {
                        checkedAt = now
                        val total = runCatching { handle.status().totalDone() }.getOrDefault(done)
                        if (total > done) { if (done >= 0) progressAt = now; done = total }
                    }
                    if (TimeUnit.NANOSECONDS.toMillis(now - progressAt) >= PIECE_STALL_MS || TimeUnit.NANOSECONDS.toMillis(now - start) >= PIECE_MAX_WAIT_MS) {
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
            // بعد إغلاق الفيديو: الملفات تُحذف ويبقى metadata.torrent فقط (كاش صغير جدًا)
            torrent?.takeIf { it.isValid }?.let { manager.remove(it, SessionHandle.DELETE_FILES) }
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
        private const val MAX_IDLE_BYTES = 64L * 1024 * 1024
        private const val MIN_FREE_BYTES = 256L * 1024 * 1024
        private const val MAX_TICKETS = 512
        private const val MAX_ACTIVE_STATES = 2
        private const val MAX_RESIDENT_STATES = 6
        private const val TICKET_TTL_MS = 30L * 60 * 1000
        private const val IDLE_TTL_MS = 60_000L
        private const val METADATA_TIMEOUT_MS = 45_000L
        private const val PIECE_STALL_MS = 30_000L
        private const val PIECE_MAX_WAIT_MS = 180_000L
        private const val IDLE_GRACE_MS = 20_000L
        private const val ONE_SECOND_NS = 1_000_000_000L
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
