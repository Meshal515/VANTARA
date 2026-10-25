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
import com.frostwire.jlibtorrent.swig.session_params
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
class TorrentEngine internal constructor(
    context: Context,
    private val sessionSettings: () -> SettingsPack = ::streamingSettings,
    /**
     * النافذة القديمة (قدّام الأندر أولًا، مسح المواعيد كلها، بلا تجهيز القطعة التالية) هي الإنتاج.
     * الجديدة (false) أسرع بلا حد (4K: 39.5 مقابل 29.3 MB/s) لكن أول بايت على 6 Mbps جاء أبطأ في
     * قياس واحد (1080p: 46.6 مقابل 24.5 ث)، فتبقى للاختبار حتى يثبتها قياس مكرر.
     */
    private val legacyWindow: Boolean = true,
    // آخر معامل: الاختبارات القديمة تمرّره lambda لاحقة
    private val networkFilter: () -> ip_filter = ::publicNetworkFilter,
) : AutoCloseable {
    private val directory = File(context.cacheDir, "torrent-streams").apply { mkdirs() }
    private val connectivity = context.applicationContext.getSystemService(android.net.ConnectivityManager::class.java)
    /** Wi-Fi أو إيثرنت (غير محسوبة). عند الشك: محدودة، فلا تُنزَّل قطع قبل الاختيار. */
    private fun unmetered(): Boolean = runCatching { connectivity?.isActiveNetworkMetered == false }.getOrDefault(false)
    private val playerPrefs = context.applicationContext.getSharedPreferences(TorrentPrefetch.PREFS, Context.MODE_PRIVATE)
    /** Wi-Fi، أو باقة جوال فعّل لها المستخدم التسخين الكامل بنفسه. */
    private fun warmPiecesAllowed(): Boolean = unmetered() || runCatching { playerPrefs.getBoolean(TorrentPrefetch.WARM_ON_METERED, false) }.getOrDefault(false)
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
            val params = SessionParams(sessionSettings())
            // جدول DHT المحفوظ: بدء بارد بلا عقد كان يكلّف عشرات الثواني قبل أول مشارك
            runCatching {
                val saved = File(directory, DHT_STATE_FILE)
                if (saved.isFile && saved.length() in 1..MAX_DHT_STATE_BYTES) params.swig().setDht_state(SessionParams(saved.readBytes()).swig().getDht_state())
            }
            start(params)
            // Addons cannot turn trackers/peers into requests to local services.
            swig().set_ip_filter(networkFilter())
        }
    }
    private val manager: SessionManager get() = managerHolder.value
    private val pruner = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "VantaraTorrentPrune").apply { isDaemon = true } }
    private val prefetcher = Executors.newFixedThreadPool(TorrentPrefetch.MAX) { task -> Thread(task, "VantaraTorrentWarm").apply { isDaemon = true } }
    /** hash → نهاية التسخين المسبق؛ لا يتجاوز [TorrentPrefetch.MAX] في أي وقت. */
    private val warming = HashMap<String, Long>()
    @Volatile private var dhtSavedAt = 0L
    init { pruner.scheduleWithFixedDelay({ runCatching { prune() }; runCatching { saveDhtState(false) } }, 1, 1, TimeUnit.MINUTES) }
    /** Process/test shutdown on a worker thread. Ordinary player close releases only its reader. */
    override fun close() {
        if (!shutdown.compareAndSet(false, true)) return
        pruner.shutdownNow(); prefetcher.shutdownNow(); tickets.clear()
        synchronized(warming) { warming.clear() }
        runCatching { saveDhtState(true) }
        val active = synchronized(states) { states.values.toList().also { states.clear() } }
        active.forEach { it.remove() }
        if (managerHolder.isInitialized()) manager.stop()
    }
    /**
     * يبدأ الجلسة وDHT في الخلفية (عند طلب نتائج الإضافات) بدل لحظة الضغط على التشغيل.
     * لا يضيف تورنت ولا ينزّل شيئًا.
     */
    fun warmUp() {
        if (shutdown.get() || managerHolder.isInitialized()) return
        runCatching { prefetcher.execute { runCatching { if (!shutdown.get() && nativeAvailable()) manager } } }
    }
    /**
     * تجهيز مسبق محدود لخيار ظهر في قائمة السيرفرات: بيانات التورنت (تُحفظ metadata.torrent)
     * واتصال بالمشاركين لـ[PREFETCH_HOLD_MS]، و[fetchEdges] يجلب طرفي الملف أيضًا. لا يشغّل فيديو،
     * ولا يحجز قارئًا (لا يُحسب في MAX_ACTIVE_STATES)، ويُلغى حين تُغلق الجلسة التذكرة.
     */
    fun prefetch(uri: Uri, fetchEdges: Boolean) {
        if (shutdown.get()) return
        val request = uri.host?.let(tickets::get)?.request ?: return
        val hash = request.infoHash
        val until = System.currentTimeMillis() + PREFETCH_HOLD_MS
        synchronized(warming) {
            val now = System.currentTimeMillis()
            warming.entries.removeIf { it.value < now }
            if (hash in warming || warming.size >= TorrentPrefetch.MAX) return
            warming[hash] = until
        }
        val submitted = runCatching {
            prefetcher.execute {
                runCatching { warm(request, until, fetchEdges) }
                    .onFailure {
                        // فشل/إلغاء: لا يبقى متصلًا خارج العدّاد
                        synchronized(warming) { if (warming[hash] == until) warming.remove(hash) }
                        states[hash]?.let { state -> runCatching { state.cool() } }
                    }
            }
        }
        if (submitted.isFailure) synchronized(warming) { warming.remove(hash) }
    }
    private fun warm(request: TorrentRequest, until: Long, fetchEdges: Boolean) {
        val hash = request.infoHash
        val stopped = { shutdown.get() || synchronized(warming) { warming[hash] != until } }
        if (stopped() || !nativeAvailable()) return
        val state = synchronized(states) {
            states[hash] ?: run {
                if (states.size >= MAX_RESIDENT_STATES) {
                    val now = System.currentTimeMillis()
                    val oldest = states.entries.filter { it.value.unused() && it.value.idleAt < now }.minByOrNull { it.value.idleAt } ?: return
                    if (states.remove(oldest.key, oldest.value)) oldest.value.remove() else return
                }
                State(hash).also { states[hash] = it }
            }
        }
        if (!state.warm(until)) return
        val handle = state.handle(stopped, request)
        state.limitWhileWarm(handle)
        val info = waitFor(stopped, METADATA_TIMEOUT_MS, "Torrent metadata unavailable") { handle.torrentFile()?.takeIf { it.isValid } }
        val selected = inspect(state, info, request)
        val pieces = if (fetchEdges && directory.usableSpace >= MIN_FREE_BYTES)
            TorrentPrefetch.warmPieces(TorrentPolicy.edges(selected, info.pieceLength()), info.pieceLength(), warmPiecesAllowed()) else emptyList()
        state.prefetched(selected, info, pieces)
    }
    private fun saveDhtState(force: Boolean) {
        if (!managerHolder.isInitialized()) return
        val now = System.currentTimeMillis()
        if (!force && now - dhtSavedAt < DHT_SAVE_INTERVAL_MS) return
        if (manager.dhtNodes() < MIN_DHT_NODES_TO_SAVE) return
        val state = manager.swig().session_state(SessionHandle.SAVE_DHT_STATE)
        val bytes = Vectors.byte_vector2bytes(session_params.write_session_params_buf(state, SessionHandle.SAVE_DHT_STATE))
        if (bytes.isEmpty() || bytes.size > MAX_DHT_STATE_BYTES) return
        val target = File(directory, DHT_STATE_FILE)
        val temp = File(directory, "$DHT_STATE_FILE.tmp")
        temp.writeBytes(bytes)
        if (temp.renameTo(target)) dhtSavedAt = now else temp.delete()
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
    fun release(uri: Uri) {
        val hash = uri.host?.let(tickets::remove)?.request?.infoHash ?: return
        // تذكرة أُغلقت جلستها: أوقف تسخينها المسبق إن لم تعد له تذكرة أخرى
        if (tickets.values.any { it.request.infoHash == hash }) return
        val cooled = synchronized(warming) { warming.remove(hash) != null }
        if (cooled && !shutdown.get()) states[hash]?.let { state -> runCatching { pruner.execute { runCatching { state.cool() } } } }
    }
    /** Routing-table size: 0 for a long time means the device cannot reach the BitTorrent network at all. */
    fun dhtNodes(): Long = if (managerHolder.isInitialized()) runCatching { manager.dhtNodes() }.getOrDefault(0L) else 0L
    /** Live swarm facts for a ticket: what Stremio shows while buffering. Null before the session exists. */
    fun stats(uri: Uri): TorrentStats? {
        val hash = uri.host?.let(tickets::get)?.request?.infoHash ?: return null
        if (!managerHolder.isInitialized()) return null
        val handle = manager.find(Sha1Hash(hash))?.takeIf { it.isValid } ?: return null
        val status = runCatching { handle.status() }.getOrNull() ?: return null
        val flags = runCatching { handle.flags() }.getOrNull()
        val state = states[hash]
        return TorrentStats(status.numPeers(), status.numSeeds(), status.downloadPayloadRate().toLong(), status.totalDone(), handle.torrentFile()?.isValid == true,
            state = status.state().name, paused = flags?.and_(TorrentFlags.PAUSED)?.nonZero() == true, candidates = status.connectCandidates(), known = status.listPeers(),
            firstPieceAt = state?.firstPieceAt ?: 0L, fileBytes = state?.fileBytes ?: 0L, pieceBytes = state?.pieceBytes ?: 0,
            metadataAt = state?.metadataAt ?: 0L, waitingPiece = state?.waitingPiece ?: -1, waitingSince = state?.waitingSince ?: 0L,
            mkvHead = state?.head?.describe(), mkvSkipped = state?.head?.skippedBytes ?: 0L,
            warmedAt = state?.warmedAt ?: 0L, warmedPieces = state?.warmedPieces ?: 0)
    }
    /** للتشخيص فقط: كتل [piece] المكتملة أو قيد الكتابة من مجموعها؛ null إن لم تبدأ بعد. */
    fun pieceBlocks(uri: Uri, piece: Int): kotlin.Pair<Int, Int>? {
        val hash = uri.host?.let(tickets::get)?.request?.infoHash ?: return null
        if (!managerHolder.isInitialized() || piece < 0) return null
        val handle = manager.find(Sha1Hash(hash))?.takeIf { it.isValid } ?: return null
        return runCatching { handle.downloadQueue.firstOrNull { it.pieceIndex() == piece }?.let { (it.finished() + it.writing()) to it.blocksInPiece() } }.getOrNull()
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
        // صار تشغيلًا حقيقيًا (بعد retain، فلا يوقفه التسخين المنتهي): يخرج من عدّاد التسخين المسبق.
        // تسخين آخر يُنزّل قطعًا ولم يُختر يتوقف فلا يزاحم المختار. تسخين البيانات فقط (الخيار الثاني،
        // الحلقة التالية) يبقى: لا يزاحم، وacquire يتكرر مع كل قفزة فلا يصح أن يقطعه.
        val others = synchronized(warming) {
            warming.remove(request.infoHash)
            warming.keys.filter { (states[it]?.warmedPieces ?: 0) > 0 }.onEach { warming.remove(it) }
        }
        for (hash in others) states[hash]?.let { other -> runCatching { pruner.execute { runCatching { other.cool() } } } }
        return try {
            val handle = state.handle(stopped, request)
            // مشغّل حقيقي: بلا حد اتصالات التسخين المسبق، ويعمل حتى لو أوقفه تسخين/خمول سابق قبل اكتمال metadata
            runCatching { handle.swig().set_max_connections(-1); handle.unsetFlags(TorrentFlags.AUTO_MANAGED); handle.resume() }
            val info = waitFor(stopped, METADATA_TIMEOUT_MS, "Torrent metadata unavailable") { handle.torrentFile()?.takeIf { it.isValid } }
            state.metadataReady()
            val selected = inspect(state, info, request)
            state.select(handle, selected, info)
            handle.unsetFlags(TorrentFlags.AUTO_MANAGED)
            handle.unsetFlags(TorrentFlags.STOP_WHEN_READY)
            // ما قدّام النافذة يُنزَّل الأقرب فالأبعد (لا الأندر أولًا): بسرعة أقل من معدل الفيديو كان
            // التحميل يتوزع على قطع بعيدة متفرقة والقطعة التي يقف عليها المشغّل تتأخر («جاهز أمامك 0»)
            if (!legacyWindow) handle.setFlags(TorrentFlags.SEQUENTIAL_DOWNLOAD)
            handle.resume()
            Lease(state, selected, info.pieceLength(), stopped)
        } catch (error: Throwable) {
            state.drop()
            if (error is IOException) throw error
            throw IOException("Native torrent preparation failed", error)
        }
    }
    /** حدود البث الآمن ومسارات الحزمة كلها، ثم الملف المختار. مشتركة بين التشغيل والتجهيز المسبق. */
    private fun inspect(state: State, info: TorrentInfo, request: TorrentRequest): TorrentFile {
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
        return selected
    }
    internal inner class Lease(private val state: State, val file: TorrentFile, val pieceLength: Int, private val cancelled: () -> Boolean) {
        private val closed = AtomicBoolean(false)
        fun read(position: Long, target: ByteArray, offset: Int, count: Int): Int {
            if (closed.get()) throw InterruptedIOException("Torrent reader closed")
            val head = state.head
            // مرفقات MKV (خطوط الترجمة): Media3 يتخطاها بقراءتها كلها؛ نعطيه أصفارًا بلا تنزيل (MkvHead)
            head?.skip?.let { range ->
                if (position in range) {
                    val n = minOf(count.toLong(), range.last + 1 - position).toInt()
                    java.util.Arrays.fill(target, offset, offset + n, 0.toByte())
                    head.skipped(n)
                    return n
                }
            }
            val plan = TorrentPolicy.readAt(file, position, pieceLength, count) ?: return -1
            state.prioritize(file, position, pieceLength)
            val bytes = state.piece(plan.piece) { closed.get() || cancelled() }
            if (plan.offset + plan.length > bytes.size) throw IOException("Verified piece shorter than selected file range")
            // القطعة التالية تُقرأ من القرص إلى الذاكرة إن اكتملت، قبل أن يصل إليها المشغّل
            if (!legacyWindow) state.readAhead(plan.piece + 1, file, pieceLength)
            bytes.copyInto(target, offset, plan.offset, plan.offset + plan.length)
            if (head != null) {
                val before = head.skip
                head.feed(position, target, offset, plan.length)
                // عُرفت المرفقات للتو: النافذة تقفز إلى ما بعدها فلا تُنزَّل قطعها
                head.skip?.takeIf { before == null }?.let { state.prioritize(file, it.last + 1, pieceLength) }
            }
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
        private var edgesWanted = false
        private var torrent: TorrentHandle? = null
        private var window = emptyList<Int>()
        /** القطع التي لها موعد الآن: يُعدَّل الفرق فقط حين تتحرك النافذة، لا تُمسح كلها وتُعاد. */
        private var deadlined = HashSet<Int>()
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
        /** أول قطعة سُلّمت للقارئ (elapsedRealtime)، لتسلسل البدء في لوحة الشبكة. */
        @Volatile var firstPieceAt = 0L; private set
        /** للتشخيص: متى اكتملت بيانات التورنت في التسخين المسبق، وكم قطعة طُلبت فيه. */
        @Volatile var warmedAt = 0L; private set
        @Volatile var warmedPieces = 0; private set
        /** بنية بداية ملف MKV كما مرّت بالقارئ؛ null لغير MKV. */
        @Volatile var head: MkvHead? = null; private set
        val fileBytes: Long get() = file?.size ?: 0L
        val pieceBytes: Int get() = pieceLength
        /** للتشخيص: متى صارت بيانات التورنت جاهزة، وأي قطعة ينتظرها القارئ الآن ومنذ متى (elapsedRealtime). */
        @Volatile var metadataAt = 0L; private set
        @Volatile var waitingPiece = -1; private set
        @Volatile var waitingSince = 0L; private set
        fun metadataReady() { if (metadataAt == 0L) metadataAt = android.os.SystemClock.elapsedRealtime() }
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
                handle.pause(); handle.clearPieceDeadlines(); deadlined.clear()
                window.forEach { handle.piecePriority(it, Priority.IGNORE) }
                aheadRange.forEach { handle.piecePriority(it, Priority.IGNORE) }
            }
            window = emptyList(); aheadRange = IntRange.EMPTY
            pieces.clear(); reading.clear(); failed.clear(); memoryBytes = 0
        }
        fun unused() = synchronized(monitor) { refs == 0 }
        /** تسخين مسبق بلا قارئ: يبقى متصلًا حتى [until] ثم يتوقف بمسار إغلاق المشغّل نفسه. */
        fun warm(until: Long): Boolean = synchronized(monitor) {
            if (refs > 0) return false
            idleAt = maxOf(idleAt, until)
            val at = idleAt
            if (!shutdown.get()) runCatching { pruner.schedule({ pauseIfStillIdle(at) }, maxOf(0L, at - System.currentTimeMillis()), TimeUnit.MILLISECONDS) }
            true
        }
        fun cool() = synchronized(monitor) {
            if (refs != 0) return@synchronized
            val now = System.currentTimeMillis()
            if (idleAt <= now) return@synchronized
            idleAt = now
            pauseIfStillIdle(now)
        }
        /** المسخَّن لا يأخذ اتصالات المشغّل (الحد العام 96). */
        fun limitWhileWarm(handle: TorrentHandle) = synchronized(monitor) {
            if (refs == 0) runCatching { handle.swig().set_max_connections(PREFETCH_CONNECTIONS) }
        }
        fun prefetched(file: TorrentFile, info: TorrentInfo, pieces: List<Int>) = synchronized(monitor) {
            // المشغّل سبقنا إليه (أو أُعيد البناء): هو صاحب الأولويات الآن
            if (refs > 0) return@synchronized
            val current = torrent?.takeIf { it.isValid } ?: return@synchronized
            select(current, file, info, fetchEdges = false)
            // أول قطعة بموعد فوري ثم الذيل؛ المشغّل حين يفتح يضع أطرافه فوقها ويجد ما اكتمل جاهزًا
            for ((piece, deadline) in TorrentPolicy.deadlines(pieces.take(1), pieces.drop(1))) {
                current.piecePriority(piece, if (deadline == 0) Priority.SEVEN else Priority.SIX)
                current.setPieceDeadline(piece, deadline)
                deadlined += piece
            }
            warmedAt = android.os.SystemClock.elapsedRealtime(); warmedPieces = pieces.size
            current.unsetFlags(TorrentFlags.STOP_WHEN_READY)
            current.resume()
        }
        fun handle(cancelled: () -> Boolean, request: TorrentRequest): TorrentHandle {
            synchronized(monitor) {
                torrent?.takeIf { it.isValid }?.let { addTrackers(it, request); return it }
                if (!starting) {
                    starting = true
                    val cached = File(folder.parentFile, "metadata.torrent")
                    val info = runCatching { if (cached.isFile && cached.length() <= 2 * 1024 * 1024) TorrentInfo(cached).takeIf { it.infoHashV1().toHex() == hash } else null }.getOrNull()
                    if (info != null) {
                        val known = info.trackers().map { it.url() }.toSet()
                        request.announce.filterNot { it in known }.forEach { info.addTracker(it) }
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
            request.announce.filterNot { it in known }.forEach { handle.addTracker(AnnounceEntry(it)) }
        }
        fun select(handle: TorrentHandle, file: TorrentFile, info: TorrentInfo, fetchEdges: Boolean = true) = synchronized(monitor) {
            if (selected != null && selected != file.index && refs > 1) throw IOException("Another file from this torrent is already playing")
            if (!initialized || selected != file.index) {
                handle.prioritizePieces(Priority.array(Priority.IGNORE, info.numPieces()))
                selected = file.index; initialized = true; window = emptyList(); aheadRange = IntRange.EMPTY; edgesWanted = false; firstPieceAt = 0L
                head = if (file.path.endsWith(".mkv", ignoreCase = true)) MkvHead() else null
                this.file = file; pieceLength = info.pieceLength()
                val metadata = File(folder.parentFile, "metadata.torrent")
                if (!metadata.isFile) runCatching { metadata.writeBytes(info.bencode()) }
            }
            if (fetchEdges && !edgesWanted) {
                // Container index lives at the head or the tail: fetch both before the extractor asks,
                // time-critical from the moment metadata exists (head first, then the tail).
                val edges = TorrentPolicy.edges(file, info.pieceLength())
                for ((piece, deadline) in TorrentPolicy.deadlines(edges.take(1), edges.drop(1))) {
                    handle.piecePriority(piece, if (deadline == 0) Priority.SEVEN else Priority.SIX)
                    handle.setPieceDeadline(piece, deadline)
                    deadlined += piece
                }
                edgesWanted = true
            }
        }
        fun prioritize(file: TorrentFile, position: Long, pieceLength: Int) = synchronized(monitor) {
            val next = TorrentPolicy.window(file, position, pieceLength)
            // رجوع لمنطقة فُرّغت من القرص: libtorrent يقرأها أصفارًا، فنعيد البناء أولًا
            if (next.isNotEmpty() && evicted(next.first())) rebuild()
            if (next == window) return@synchronized
            if (directory.usableSpace < MIN_FREE_BYTES || allocatedBytes(folder) > MAX_ACTIVE_BYTES) throw IOException("Insufficient torrent cache space")
            val handle = torrent ?: throw IOException("Torrent session ended")
            window.filterNot { it in next }.forEach { handle.piecePriority(it, Priority.IGNORE) }
            // طرفا الملف لم يكتملا بعد (المستخرج يقفز إلى الفهرس قبل أول إطار): يبقيان بموعد قريب
            val pending = TorrentPolicy.edges(file, pieceLength).filter { it !in next && !handle.havePiece(it) }
            val wanted = TorrentPolicy.deadlines(next, pending)
            if (legacyWindow) {
                handle.clearPieceDeadlines()
                for ((piece, deadline) in wanted) {
                    handle.piecePriority(piece, if (deadline == 0) Priority.SEVEN else Priority.SIX)
                    handle.setPieceDeadline(piece, deadline)
                }
            } else {
                // الفرق فقط: مسح كل المواعيد ثم إعادتها عند كل قطعة كان يلغي طلبات القطع الجارية عند المشاركين
                val keep = wanted.mapTo(HashSet()) { it.first }
                for (piece in deadlined) if (piece !in keep) handle.resetPieceDeadline(piece)
                for ((piece, deadline) in wanted) {
                    if (piece in deadlined && deadline != 0) continue
                    handle.piecePriority(piece, if (deadline == 0) Priority.SEVEN else Priority.SIX)
                    if (piece !in deadlined) handle.setPieceDeadline(piece, deadline)
                }
                deadlined = keep
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
            if (!legacyWindow) handle.setFlags(TorrentFlags.SEQUENTIAL_DOWNLOAD)
            deadlined.clear()
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
            try { synchronized(monitor) {
                while (true) {
                    checkCancelled(cancelled)
                    pieces[piece]?.let { return it }
                    if (waitingPiece != piece) { waitingPiece = piece; waitingSince = android.os.SystemClock.elapsedRealtime() }
                    if (refs == 0) throw InterruptedIOException("Torrent has no active reader")
                    if (evicted(piece)) rebuild()
                    if (failed.remove(piece)) throw IOException("Torrent piece read failed")
                    val handle = torrent ?: throw IOException("Torrent session ended")
                    if (handle.status().errorCode().value() != 0) throw IOException("Torrent host/download failure")
                    if (handle.havePiece(piece) && reading.add(piece)) handle.readPiece(piece)
                    // A 4K piece can be 16 MB: fail on a stalled swarm, not on a slow but moving one.
                    // البايتات الواصلة لا القطع المكتملة: بسرعة 6 Mbps وقطع كبيرة لا تكتمل قطعة خلال 30 ث
                    // والتحميل مستمر، فكان يُحكم بالتوقف ويفشل التشغيل («try another source»).
                    val now = System.nanoTime()
                    if (now - checkedAt >= ONE_SECOND_NS) {
                        checkedAt = now
                        val total = runCatching { handle.status().totalPayloadDownload() }.getOrDefault(done)
                        if (total > done) { if (done >= 0) progressAt = now; done = total }
                    }
                    if (TimeUnit.NANOSECONDS.toMillis(now - progressAt) >= PIECE_STALL_MS || TimeUnit.NANOSECONDS.toMillis(now - start) >= PIECE_MAX_WAIT_MS) {
                        reading.remove(piece)
                        throw IOException("Torrent buffer timed out; try another source")
                    }
                    try { monitor.wait(100) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); throw InterruptedIOException("Torrent read interrupted") }
                }
            } } finally { if (waitingPiece == piece) waitingPiece = -1 }
        }
        /** إن اكتملت [piece] ولم تكن في الذاكرة: تُطلب قراءتها الآن (لا انتظار؛ تصل عبر received). */
        fun readAhead(piece: Int, file: TorrentFile, pieceLength: Int) = synchronized(monitor) {
            if (refs == 0 || piece > ((file.offset + file.size - 1) / pieceLength).toInt() || pieces.containsKey(piece) || piece in reading || evicted(piece)) return@synchronized
            val handle = torrent?.takeIf { it.isValid } ?: return@synchronized
            if (handle.havePiece(piece) && reading.add(piece)) handle.readPiece(piece)
        }
        fun reading(piece: Int): Boolean = synchronized(monitor) { piece in reading }
        fun received(piece: Int, bytes: ByteArray) = synchronized(monitor) {
            if (!reading.remove(piece)) return@synchronized
            while (pieces.isNotEmpty() && memoryBytes + bytes.size > MAX_MEMORY_BYTES) {
                val first = pieces.entries.first(); memoryBytes -= first.value.size; pieces.remove(first.key)
            }
            pieces.put(piece, bytes)?.let { memoryBytes -= it.size }; memoryBytes += bytes.size
            if (firstPieceAt == 0L) firstPieceAt = android.os.SystemClock.elapsedRealtime()
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
        private const val PREFETCH_HOLD_MS = 90_000L
        private const val PREFETCH_CONNECTIONS = 24
        private const val DHT_STATE_FILE = "dht.state"
        private const val MAX_DHT_STATE_BYTES = 512 * 1024
        private const val DHT_SAVE_INTERVAL_MS = 5L * 60 * 1000
        private const val MIN_DHT_NODES_TO_SAVE = 16L
        /**
         * إعدادات بدء سريع للبث (لا تمسّ حدود الأمان): اتصال أسرع بالمشاركين، إعلان لكل المتتبّعات
         * دفعة واحدة بدل طبقة بعد طبقة (كل متتبّع في magnet طبقة مستقلة، فكان كل متتبّع ميت يؤخر
         * التالي حتى تنتهي مهلته)، ومهل أقصر لطلبات القطع المتعثرة.
         */
        internal fun streamingSettings(): SettingsPack {
            // اتصالات ومهل قيست على محاكي وأسراب Torrentio حقيقية (TorrentSwarmDiscoveryDeviceTest): بحدود
            // 96 اتصالًا/60 في الثانية ومهلة 7 ث وحد رفع 128KB/s كان يعرف 500–700 مشارك ويتصل بـ4–10 في
            // أول 5 ثوانٍ؛ بهذه القيم 21–45 والبيانات تصل أبكر. حد الرفع أُلغي: رسائل طلب القطع وعبء IP
            // تُحسب على الرفع، فالحد كان يبطئ التنزيل نفسه.
            val settings = SettingsPack().connectionsLimit(400).activeDownloads(2).activeSeeds(0).activeLimit(2)
                .maxPeerlistSize(1000).uploadRateLimit(0).maxQueuedDiskBytes(8 * 1024 * 1024)
                .validateHttpsTrackers(true).stopTrackerTimeout(1)
            settings.setEnableLsd(false)
            settings.setBoolean(settings_pack.bool_types.ssrf_mitigation.swigValue(), true)
            settings.setBoolean(settings_pack.bool_types.apply_ip_filter_to_trackers.swigValue(), true)
            settings.setBoolean(settings_pack.bool_types.announce_to_all_trackers.swigValue(), true)
            settings.setBoolean(settings_pack.bool_types.announce_to_all_tiers.swigValue(), true)
            settings.setBoolean(settings_pack.bool_types.strict_end_game_mode.swigValue(), false)
            // تورنت اكتملت قطعه المطلوبة (طرفا الملف مسبقًا، أو نافذة قدّام امتلأت) كان يقطع المشاركين
            // الكاملين؛ القطعة التالية تنتظر إعادة اتصال (~5 ث في اختبار سرب محلي حقيقي، 52ms بدونه).
            settings.setBoolean(settings_pack.bool_types.close_redundant_connections.swigValue(), false)
            settings.setInteger(settings_pack.int_types.connection_speed.swigValue(), 200)
            settings.setInteger(settings_pack.int_types.torrent_connect_boost.swigValue(), 100)
            // شبكات الجوال بطيئة المصافحة: مهلة 7 ث كانت تُسقط مشاركين صالحين
            settings.setInteger(settings_pack.int_types.peer_connect_timeout.swigValue(), 15)
            settings.setInteger(settings_pack.int_types.handshake_timeout.swigValue(), 15)
            settings.setInteger(settings_pack.int_types.tracker_receive_timeout.swigValue(), 6)
            settings.setInteger(settings_pack.int_types.tracker_completion_timeout.swigValue(), 15)
            // Stremio (btRequestTimeout 4000): طلب لم يُجب خلال 4 ث يُعاد طلبه من مشارك آخر،
            // فلا يعلّق مشارك بطيء القطعة التي ينتظرها المشغّل
            settings.setInteger(settings_pack.int_types.request_timeout.swigValue(), 4)
            settings.setInteger(settings_pack.int_types.piece_timeout.swigValue(), 8)
            // القطع المستعجلة قبل الجملة (stremio-libtorrent-playback-fix): طوابير الطلب الافتراضية
            // تمتلئ بقطع لا يحتاجها التشغيل فتنتظر قطعة الموضع الحالي خلفها. طابور أقصر وزمن أقصر،
            // وبلا تفضيل القطعة الكاملة أو المجاورة، فتتقدّم كتل القطعة ذات الموعد.
            settings.setInteger(settings_pack.int_types.max_out_request_queue.swigValue(), 250)
            settings.setInteger(settings_pack.int_types.request_queue_time.swigValue(), 1)
            settings.setInteger(settings_pack.int_types.whole_pieces_threshold.swigValue(), 0)
            settings.setBoolean(settings_pack.bool_types.piece_extent_affinity.swigValue(), false)
            // مشاركون خلف NAT لا يصلون إلا باتصال داخل: افتح المنفذ تلقائيًا حيث يسمح الراوتر
            // TCP وحده كما Stremio (torrent-stream): uTP يتراجع مع كل تذبذب في تأخير الشبكة. قيس على
            // المحاكي بأسراب Torrentio حقيقية (TorrentThroughputDeviceTest): بلا uTP تضاعف ما يصل
            // للمشغّل في كل المقارنات الثماني — 4K من 18.5 إلى 39 MB/s، و1080p من 5.8 إلى 13.7 MB/s.
            settings.setBoolean(settings_pack.bool_types.enable_outgoing_utp.swigValue(), false)
            settings.setBoolean(settings_pack.bool_types.enable_incoming_utp.swigValue(), false)
            settings.setBoolean(settings_pack.bool_types.enable_upnp.swigValue(), true)
            settings.setBoolean(settings_pack.bool_types.enable_natpmp.swigValue(), true)
            return settings
        }
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
