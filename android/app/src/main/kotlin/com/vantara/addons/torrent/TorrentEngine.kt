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

/** طلب قراءة مبكرة داخل القطعة المنتظرة ([TurboRead]): [offset] و[length] منها؛ [span] يُملأ إن كفت الكتل المكتوبة. */
internal class TurboAsk(val offset: Int, val length: Int) { var span = 0 }

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
    /**
     * المواعيد بالفرق (TorrentPolicy.deadlineDiff) مستقلة عن [legacyWindow]: الأخير يبقى للتنزيل التسلسلي
     * وقراءة القطعة التالية مسبقًا (هما ما يُشتبه أنه أبطأ أول بايت في قياس 6 Mbps الوحيد). false = المسح
     * الكامل القديم، للمقارنة فقط في TorrentThroughputDeviceTest.
     */
    private val diffDeadlines: Boolean = true,
    // آخر معامل: الاختبارات القديمة تمرّره lambda لاحقة
    private val networkFilter: () -> ip_filter = ::publicNetworkFilter,
) : AutoCloseable {
    private val directory = File(context.cacheDir, "torrent-streams").apply { mkdirs() }
    private val connectivity = context.applicationContext.getSystemService(android.net.ConnectivityManager::class.java)
    /** Wi-Fi أو إيثرنت (غير محسوبة). عند الشك: محدودة، فلا تُنزَّل قطع قبل الاختيار. */
    private fun unmetered(): Boolean = runCatching { connectivity?.isActiveNetworkMetered == false }.getOrDefault(false)
    /**
     * استئناف تورنت أوقفه تسخين منتهٍ أو خمول: الإيقاف قطع كل المشاركين، والاستئناف وحده لا يسأل المتتبعات وDHT حتى
     * موعدها، فيبدأ بالقلة المعروفة ثم «يكثرون فجأة» (عيّنة المالك على ويندوز: أول صورة +20 ث). إعلان فوري كالإضافة الأولى.
     */
    private fun resumeAnnounced(handle: TorrentHandle) = runCatching {
        val wasPaused = handle.flags().and_(TorrentFlags.PAUSED).nonZero()
        handle.unsetFlags(TorrentFlags.AUTO_MANAGED); handle.resume()
        if (wasPaused) { handle.forceReannounce(); handle.forceDHTAnnounce() }
    }
    @Volatile private var connectTimeoutApplied = -1
    /**
     * مهلة اتصال المشارك حسب الشبكة: 3 ث على Wi-Fi و15 على بيانات الجوال (مصافحتها أبطأ، و7 ث كانت تُسقط
     * مشاركين صالحين). قياس stall-bench بثلاثين مشاركًا ميتًا قبل الحيّين وحد اتصالات التسخين (24/12): أول قطعة
     * 16–32 ث بمهلة 15، و4.0 ث بمهلة 3؛ بلا حد اتصالات (التشغيل) 2.0 ث في الحالتين. يُطبَّق عند التسخين والتشغيل.
     */
    private fun tuneConnectTimeout() {
        if (!managerHolder.isInitialized()) return
        val want = if (unmetered()) CONNECT_TIMEOUT_UNMETERED_S else CONNECT_TIMEOUT_METERED_S
        if (want == connectTimeoutApplied) return
        runCatching { manager.applySettings(SettingsPack().apply { setInteger(settings_pack.int_types.peer_connect_timeout.swigValue(), want) }) }
            .onSuccess { connectTimeoutApplied = want }
    }
    private val playerPrefs = context.applicationContext.getSharedPreferences(TorrentPrefetch.PREFS, Context.MODE_PRIVATE)
    /** Wi-Fi، أو باقة جوال فعّل لها المستخدم التسخين الكامل بنفسه. */
    private fun warmPiecesAllowed(): Boolean = unmetered() || runCatching { playerPrefs.getBoolean(TorrentPrefetch.WARM_ON_METERED, false) }.getOrDefault(false)
    private val shutdown = AtomicBoolean(false)
    private data class Ticket(val request: TorrentRequest, @Volatile var touched: Long = System.currentTimeMillis())
    private val tickets = ConcurrentHashMap<String, Ticket>()
    private val states = ConcurrentHashMap<String, State>()
    /**
     * تورنتات يبدأ مشغّلها بلا فهرس الحاوية ([deferTail]): الذيل لا يُطلب بموعد قبل أول صورة، وينزل بأولوية أقل.
     * عينة Reacher (قطع 16MB): انتظار الذيل وحده 13 و24 ث من 21 و32 ث حتى أول صورة.
     */
    private val tailDeferred = ConcurrentHashMap.newKeySet<String>()
    /** تورنتات فشل تحقق قطعة قُرئت منها قبل التحقق ([TurboRead]): موثقة فقط ما بقي المحرك. */
    private val verifiedOnly = ConcurrentHashMap.newKeySet<String>()
    private val turboListeners = java.util.concurrent.CopyOnWriteArraySet<(String) -> Unit>()
    /** المشغّل يُبلَّغ بهوية التورنت (infoHash) حين يفشل تحقق قطعة قرأ منها قبل التحقق، فيعيد تجهيز المصدر. */
    fun addTurboListener(listener: (String) -> Unit) { turboListeners.add(listener) }
    fun removeTurboListener(listener: (String) -> Unit) { turboListeners.remove(listener) }
    private fun unverifiedFailed(hash: String) {
        verifiedOnly.add(hash)
        for (listener in turboListeners) runCatching { listener(hash) }
    }
    /** الخيار B مسموح لهذا التورنت الآن: Debug فقط، والمفتاح مفعّل (افتراضيًا)، ولم يفشل له تحقق قطعة قُرئت مبكرًا. */
    private fun turboAllowed(hash: String): Boolean = com.vantara.app.BuildConfig.DEBUG && hash !in verifiedOnly &&
        runCatching { playerPrefs.getBoolean(TurboRead.PREF, true) }.getOrDefault(false)
    /**
     * تنزيل دائم واحد لكل تورنت في وقت واحد (TD2): حلقتان من حزمة موسم واحدة تتشاركان مقبض libtorrent نفسه
     * (أولويات الملفات، مسار الحفظ، والتقدّم)، فكانت الثانية تُوقف ملف الأولى ثم «تكمل» الاثنتين ويُحفظ ملف الأولى ناقصًا.
     */
    private val permanentActive = ConcurrentHashMap.newKeySet<String>()
    private val permanentLocks = ConcurrentHashMap<String, java.util.concurrent.locks.ReentrantLock>()
    private val managerHolder = lazy {
        check(nativeAvailable()) { "Native torrent library unavailable on device ABI" }
        SessionManager(false).apply {
            addListener(object : AlertListener {
                override fun types() = intArrayOf(AlertType.READ_PIECE.swig(), AlertType.BLOCK_FINISHED.swig(), AlertType.PIECE_FINISHED.swig(), AlertType.HASH_FAILED.swig())
                override fun alert(alert: Alert<*>) {
                    // الخيار B (TurboRead): ما كُتب من كتل القطع الناقصة، وحسم تحققها
                    when (alert) {
                        is BlockFinishedAlert -> { states[alert.handle().infoHash().toHex()]?.blockWritten(alert.pieceIndex(), alert.blockIndex()); return }
                        is PieceFinishedAlert -> { states[alert.handle().infoHash().toHex()]?.pieceVerified(alert.pieceIndex()); return }
                        is HashFailedAlert -> {
                            val failedHash = alert.handle().infoHash().toHex()
                            if (states[failedHash]?.hashFailed(alert.pieceIndex()) == true) unverifiedFailed(failedHash)
                            return
                        }
                        else -> Unit
                    }
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
            // libtorrent المخصص يقرأ ضبطه من البيئة مرة واحدة عند أول استعمال، فيُضبط قبل بدء الجلسة
            if (PATCHED) {
                runCatching { Os.setenv("VANTARA_LT_STALL_CAP_MS", STALL_CAP_MS.toString(), true) }
                runCatching { Os.setenv("VANTARA_LT_HEDGE_MS", HEDGE_MS.toString(), true) }
            }
            val params = SessionParams(sessionSettings())
            // جدول DHT المحفوظ: بدء بارد بلا عقد كان يكلّف عشرات الثواني قبل أول مشارك
            runCatching {
                val saved = File(directory, DHT_STATE_FILE)
                if (saved.isFile && saved.length() in 1..MAX_DHT_STATE_BYTES) params.swig().setDht_state(SessionParams(saved.readBytes()).swig().getDht_state())
            }
            start(params)
            // Addons cannot turn trackers/peers into requests to local services.
            swig().set_ip_filter(currentFilter())
        }
    }
    private val manager: SessionManager get() = managerHolder.value
    /** مشاركون محجوبون مؤقتًا بالـhotswap (ip → حتى متى). */
    private val swapped = ConcurrentHashMap<String, Long>()
    private fun currentFilter(): ip_filter = networkFilter().apply {
        val now = System.currentTimeMillis()
        for ((ip, until) in swapped) if (until > now) runCatching { val a = Address(ip).swig(); add_rule(a, a, 1) }
    }
    /** يحجب [ips] مؤقتًا فينقطعون وتتحرر كتلهم، ثم يرفع الحجب بعد [TorrentHotswap.BAN_MS]. */
    private fun hotswap(ips: List<String>) {
        if (ips.isEmpty() || !managerHolder.isInitialized()) return
        val until = System.currentTimeMillis() + TorrentHotswap.BAN_MS
        for (ip in ips) swapped[ip] = until
        runCatching { manager.swig().set_ip_filter(currentFilter()) }
        runCatching { pruner.schedule({
            val now = System.currentTimeMillis()
            if (swapped.entries.removeIf { it.value <= now } && !shutdown.get()) runCatching { manager.swig().set_ip_filter(currentFilter()) }
        }, TorrentHotswap.BAN_MS + 500, TimeUnit.MILLISECONDS) }
    }
    private val pruner = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "VantaraTorrentPrune").apply { isDaemon = true } }
    private val prefetcher = Executors.newFixedThreadPool(TorrentPrefetch.MAX) { task -> Thread(task, "VantaraTorrentWarm").apply { isDaemon = true } }
    /** hash → نهاية التسخين المسبق؛ لا يتجاوز [TorrentPrefetch.MAX] في أي وقت. */
    private val warming = HashMap<String, Long>()
    /**
     * التسخين الخلفي (الصفوف الظاهرة غير «المقترح»): hash → نهايته. يُقفل بـ[warming] نفسه، ولا يُحسب في حدها،
     * وله منفذه وحده فلا ينتظر «المقترح» خلفه. اتصالات أقل وسرعة محدودة: يأخذ الفائض ولا يزاحم.
     */
    private val background = HashMap<String, Long>()
    private val backgroundPool = Executors.newFixedThreadPool(TorrentPrefetch.BACKGROUND_MAX) { task -> Thread(task, "VantaraTorrentWarmBg").apply { isDaemon = true } }
    @Volatile private var dhtSavedAt = 0L
    init { pruner.scheduleWithFixedDelay({ runCatching { prune() }; runCatching { saveDhtState(false) } }, 1, 1, TimeUnit.MINUTES) }
    /** Process/test shutdown on a worker thread. Ordinary player close releases only its reader. */
    override fun close() {
        if (!shutdown.compareAndSet(false, true)) return
        pruner.shutdownNow(); prefetcher.shutdownNow(); backgroundPool.shutdownNow(); tickets.clear()
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
    fun prefetch(uri: Uri, fetchEdges: Boolean, priority: Boolean = false) {
        if (shutdown.get()) return
        val request = uri.host?.let(tickets::get)?.request ?: return
        val hash = request.infoHash
        val until = System.currentTimeMillis() + PREFETCH_HOLD_MS
        var evicted: String? = null
        synchronized(warming) {
            val now = System.currentTimeMillis()
            warming.entries.removeIf { it.value < now }
            // «المقترح» في ورقة السيرفرات (priority) هو ما سيُشغَّل غالبًا: يأخذ مكانه ولو كان الترتيب الأصلي سخّن غيره.
            // إن كان يُسخَّن أصلًا بلا قطع (الخيار الثاني: بيانات فقط) يُعاد تسخينه بالقطع؛ الخيط القديم يتوقف وحده
            // (warming[hash] != until). عينات الجهاز (26 نوفمبر): 4 من 7 تشغيلات «لم يُسخَّن هذا الخيار».
            if (hash in warming && !priority) return
            // كان يُسخَّن في الخلفية ثم صار «المقترح»: يُرفع (خيط الخلفية يتوقف وحده لأن نهايته تغيّرت)
            background.remove(hash)
            if (hash !in warming && warming.size >= TorrentPrefetch.MAX) {
                if (!priority) return
                evicted = warming.entries.minByOrNull { it.value }?.key
                evicted?.let { warming.remove(it) }
            }
            warming[hash] = until
        }
        evicted?.let { old -> states[old]?.let { runCatching { it.cool() } } }
        val submitted = runCatching {
            prefetcher.execute {
                runCatching { warm(request, until, fetchEdges, bg = false) }
                    .onFailure {
                        // فشل/إلغاء: لا يبقى متصلًا خارج العدّاد
                        synchronized(warming) { if (warming[hash] == until) warming.remove(hash) }
                        states[hash]?.let { state -> runCatching { state.cool() } }
                    }
            }
        }
        if (submitted.isFailure) synchronized(warming) { warming.remove(hash) }
    }

    /**
     * الصفوف الظاهرة في ورقة السيرفرات غير «المقترح»، مرتبة من الورقة (السرب ثم حجم القطعة ثم العربي): أول
     * [TorrentPrefetch.BACKGROUND_MAX] تُسخَّن في الخلفية، وما خرج من القائمة يهدأ. بيانات واتصالات دائمًا، وأول قطعة
     * فقط على شبكة غير محدودة بسرعة محدودة. ما يُسخَّن بأولوية أو يُشغَّل الآن لا يُلمس.
     */
    fun prefetchBackground(uris: List<Uri>) {
        if (shutdown.get()) return
        val requests = uris.mapNotNull { u -> u.host?.let(tickets::get)?.request }.distinctBy { it.infoHash }
        val until = System.currentTimeMillis() + PREFETCH_HOLD_MS
        val start = ArrayList<TorrentRequest>()
        val dropped: List<String>
        synchronized(warming) {
            val busy = synchronized(states) { states.filterValues { !it.unused() }.keys + permanentActive }
            val wanted = requests.filter { it.infoHash !in warming && it.infoHash !in busy }.take(TorrentPrefetch.BACKGROUND_MAX)
            val keep = wanted.map { it.infoHash }.toSet()
            dropped = background.keys.filter { it !in keep }
            dropped.forEach { background.remove(it) }
            for (r in wanted) if (r.infoHash !in background) { background[r.infoHash] = until; start += r }
        }
        for (hash in dropped) states[hash]?.let { runCatching { it.cool() } }
        for (r in start) {
            val submitted = runCatching {
                backgroundPool.execute {
                    runCatching { warm(r, until, fetchEdges = true, bg = true) }.onFailure {
                        synchronized(warming) { if (background[r.infoHash] == until) background.remove(r.infoHash) }
                        states[r.infoHash]?.let { state -> runCatching { state.cool() } }
                    }
                }
            }
            if (submitted.isFailure) synchronized(warming) { background.remove(r.infoHash) }
        }
    }

    /** الورقة أُغلقت أو بدأ تشغيل: التسخين الخلفي كله يهدأ. «المقترح» يبقى لمدته (غالبًا هو ما يُشغَّل). */
    fun coolBackground() {
        val hashes = synchronized(warming) { background.keys.toList().also { background.clear() } }
        for (hash in hashes) states[hash]?.let { runCatching { it.cool() } }
    }
    private fun warm(request: TorrentRequest, until: Long, fetchEdges: Boolean, bg: Boolean) {
        val hash = request.infoHash
        val stopped = { shutdown.get() || synchronized(warming) { (if (bg) background[hash] else warming[hash]) != until } }
        if (stopped() || !nativeAvailable()) return
        tuneConnectTimeout()
        val state = synchronized(states) {
            if (hash in permanentActive) return
            states[hash] ?: run {
                // الخلفي لا يُخلي أحدًا (الإخلاء يحذف الملفات): كان يحذف قطع «المقترح» المسخَّنة بعد انتهاء مهلتها
                if (bg && states.size >= MAX_RESIDENT_STATES) return
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
        // مقبض موجود يعود كما هو؛ إن هدّأه تسخين سابق (cool ← pause) فهو موقوف: إعادة التسخين تستأنفه وتعلن فورًا
        resumeAnnounced(handle)
        state.limitWhileWarm(handle, if (bg) TorrentPrefetch.BACKGROUND_RATE else -1)
        val info = waitFor(stopped, METADATA_TIMEOUT_MS, "Torrent metadata unavailable") { handle.torrentFile()?.takeIf { it.isValid } }
        val selected = inspect(state, info, request)
        if (stopped()) return
        val edges = TorrentPolicy.edges(selected, info.pieceLength())
        val pieces = if (!fetchEdges || directory.usableSpace < MIN_FREE_BYTES) emptyList()
            // الخلفي: أول قطعة فقط وبميزانية أصغر؛ الفهرس للمقترح وحده
            else if (bg) TorrentPrefetch.warmPieces(edges.take(1), info.pieceLength(), warmPiecesAllowed(), TorrentPrefetch.BACKGROUND_BUDGET)
            else TorrentPrefetch.warmPieces(edges, info.pieceLength(), warmPiecesAllowed())
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
    /** المشغّل يبدأ هذا المصدر بلا فهرس (أول صورة من الرأس) [on]، أو يحتاج الفهرس الآن (قفزة، استئناف). */
    fun deferTail(uri: Uri, on: Boolean) {
        val hash = uri.host?.let(tickets::get)?.request?.infoHash ?: return
        if (on) tailDeferred.add(hash) else tailDeferred.remove(hash)
    }
    /** طلب التورنت خلف تذكرة تشغيل (`vantara-torrent://…`): للتنزيل الدائم من الاختيار نفسه. */
    fun requestOf(uri: Uri): TorrentRequest? =
        if (uri.scheme == SCHEME && uri.path == "/file") uri.host?.let(tickets::get)?.request else null

    /** تقدّم تنزيل تورنت دائم: بايتات الملف المطلوب، المشاركون، والقطع المتحقق منها. */
    data class PermanentProgress(val done: Long, val total: Long, val peers: Int, val rate: Long, val pieces: Int, val piecesTotal: Int, val file: String?)

    /**
     * تنزيل دائم (التحميلات): ملف واحد من التورنت كاملًا إلى [dest] — مجلد التحميلات لا كاش البث.
     *
     * نفس جلسة libtorrent (DHT وحظر العناوين الداخلية نفسها)، لكن بلا نافذة بث ولا إخلاء قطع: كل قطع الملف
     * المختار بأولوية عادية وبقية ملفات التورنت IGNORE. libtorrent يتحقق من بصمة كل قطعة قبل عدّها، وعند
     * الإضافة فوق بيانات موجودة يفحصها ويكمل من الصالح (الاستئناف). عند الاكتمال يُزال من الجلسة والملف باقٍ.
     * التورنت نفسه وهو يُشغَّل بثًا لا يُضاف مرتين: TORRENT_BUSY بسبب واضح.
     */
    fun downloadPermanent(request: TorrentRequest, dest: File, cancelled: () -> Boolean, progress: (PermanentProgress) -> Unit): File {
        check(!shutdown.get()) { "Torrent engine is closed" }
        val lock = permanentLocks.computeIfAbsent(request.infoHash) { java.util.concurrent.locks.ReentrantLock() }
        // ينتظر دوره بلا حجز للإلغاء: الإيقاف يُحترم أثناء الانتظار
        try {
            while (!lock.tryLock(500, TimeUnit.MILLISECONDS)) {
                if (cancelled() || Thread.currentThread().isInterrupted) throw InterruptedIOException("Torrent download cancelled")
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            throw InterruptedIOException("Torrent download interrupted")
        }
        try {
            return downloadPermanentLocked(request, dest, cancelled, progress)
        } finally {
            permanentActive.remove(request.infoHash)
            lock.unlock()
        }
    }

    private fun downloadPermanentLocked(request: TorrentRequest, dest: File, cancelled: () -> Boolean, progress: (PermanentProgress) -> Unit): File {
        val hash = request.infoHash
        // حالة بث بلا قارئ (تسخين ورقة السيرفرات، أو مشاهدة انتهت وبقيت للعودة السريعة) لا تمنع التنزيل: تُخلى
        // ويُنزَّل إلى مجلد التحميلات. كانت أي حالة باقية ترفض بـTORRENT_BUSY ⇒ «المصدر رفض الطلب» بعد مجرد فتح
        // ورقة السيرفرات. المشغّل المفتوح فعلًا وحده يمنع (لا يُنزَع ملف من تحت فيديو يُشاهَد)
        synchronized(states) {
            val existing = states[hash]
            if (existing?.unused() == false) throw IOException("TORRENT_BUSY")
            permanentActive.add(hash)
            if (existing != null) {
                synchronized(warming) { warming.remove(hash) }
                if (states.remove(hash, existing)) existing.remove()
            }
        }
        // الإزالة غير متزامنة. المقبض القديم قد يبقى ظاهرًا بعد انتهاء حلقة من الحزمة نفسها.
        // لا نغيّر أولوياته أو نكتب في مساره بينما ينتظر المحرك إغلاقه.
        waitFor(cancelled, 5_000, "Torrent handle still closing") {
            if (manager.find(Sha1Hash(hash))?.isValid == true) null else Unit
        }
        dest.mkdirs()
        manager.download(request.magnetUri(), dest, com.frostwire.jlibtorrent.swig.torrent_flags_t())
        val h = waitFor(cancelled, METADATA_TIMEOUT_MS, "Torrent session unavailable") {
            manager.find(Sha1Hash(hash))?.takeIf { it.isValid }
        }
        try {
            // كمسار التشغيل (21–45 مشاركًا في الاختبار الحي): بلا حد اتصالات للتورنت، ومتتبّعات الإضافة والقائمة العامة
            // على المقبض نفسه، وإعلان فوري للمتتبّعات وDHT. كان التنزيل الدائم يكتفي بما في magnet ويبدأ بمشاركَين
            runCatching { h.swig().set_max_connections(-1); h.unsetFlags(TorrentFlags.AUTO_MANAGED); h.resume() }
            runCatching {
                val known = h.trackers().map { it.url() }.toSet()
                request.announce.filterNot { it in known }.forEach { h.addTracker(AnnounceEntry(it)) }
                h.forceReannounce()
                h.forceDHTAnnounce()
            }
            val info = waitFor(cancelled, METADATA_TIMEOUT_MS, "Torrent metadata unavailable") { h.torrentFile()?.takeIf { it.isValid } }
            val files = info.files()
            val listed = (0 until files.numFiles()).filterNot { files.padFileAt(it) }.map { TorrentFile(it, files.filePath(it), files.fileSize(it), files.fileOffset(it)) }
            // نفس قرار التشغيل (TR1): fileIdx، ثم اسم الملف، ثم رقم الحلقة؛ الأكبر فقط حين لا تُطلب حلقة
            val index = try { TorrentPolicy.selectFile(listed, request.fileIdx, request.episode, request.filename).index } catch (e: IllegalArgumentException) {
                throw IOException(if (e.message == "EPISODE_NOT_IN_TORRENT") "EPISODE_NOT_IN_TORRENT" else "Requested torrent file is not a playable video")
            }
            h.prioritizeFiles(Array(files.numFiles()) { if (it == index) Priority.FOUR else Priority.IGNORE })
            val name = files.filePath(index)
            var lastDone = -1L
            var stalledSince = System.currentTimeMillis()
            while (true) {
                if (cancelled() || Thread.currentThread().isInterrupted) {
                    runCatching { h.pause() }
                    throw InterruptedIOException("Torrent download cancelled")
                }
                val st = h.status()
                val done = st.totalWantedDone()
                val total = st.totalWanted()
                progress(PermanentProgress(done, total, st.numPeers(), st.downloadPayloadRate().toLong(), st.numPieces(), info.numPieces(), name))
                // كل القطع المطلوبة متحقق منها (totalWantedDone يعدّ الموثّق وحده): انتهى، بلا انتظار علم isFinished المتأخر
                if (total > 0 && done >= total) break
                if (done != lastDone) { lastDone = done; stalledSince = System.currentTimeMillis() }
                else if (System.currentTimeMillis() - stalledSince > PERMANENT_STALL_MS) throw IOException(if (st.numPeers() == 0) "NO_PEERS" else "TORRENT_STALLED")
                try { Thread.sleep(1000) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); throw InterruptedIOException("Torrent download interrupted") }
            }
            val out = File(dest, name)
            // «مكتمل» يعني ملف الحلقة نفسها بحجمه الكامل في مجلد هذا العنصر، لا مجرد ملف موجود
            if (!out.isFile || out.length() != files.fileSize(index)) throw IOException("TORRENT_INCOMPLETE")
            return out
        } finally {
            // الملف يبقى في مجلده؛ الجلسة لا تحتفظ بالتورنت بعد انتهاء العمل أو إيقافه (يُستأنف بإضافته من جديد وفحص قطعه)
            runCatching { manager.remove(h) }
            // التنزيل التالي من الحزمة نفسها لا يلتقط هذا المقبض وهو يُغلق (مسار حفظه مجلد هذا العنصر)
            runCatching { waitFor({ false }, 5_000, "Torrent handle still closing") { if (manager.find(Sha1Hash(hash))?.isValid == true) null else Unit } }
        }
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
    /**
     * حقائق مقاسة لتورنت في المحرك الآن (مُسخَّن أو يعمل): حجم القطعة من البيانات الوصفية، والسرب كما رآه المحرك
     * (أكبر من رد المتتبع num_complete والباذرين المعروفين list_seeds) والمتصلون. null قبل البيانات الوصفية.
     * لـ«المقترح» في ورقة السيرفرات: زمن أول قطعة ≈ حجم القطعة ÷ المعدل، والمعلن في عنوان الإضافة قد يكون قديمًا.
     */
    fun facts(uri: Uri): TorrentFacts? {
        val hash = uri.host?.let(tickets::get)?.request?.infoHash ?: return null
        if (!managerHolder.isInitialized()) return null
        val handle = manager.find(Sha1Hash(hash))?.takeIf { it.isValid } ?: return null
        val info = runCatching { handle.torrentFile() }.getOrNull()?.takeIf { it.isValid } ?: return null
        val status = runCatching { handle.status() }.getOrNull() ?: return null
        return TorrentFacts(info.pieceLength(), maxOf(status.numComplete(), status.listSeeds()), status.numPeers())
    }
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
            warmedAt = state?.warmedAt ?: 0L, warmedPieces = state?.warmedPieces ?: 0, swaps = state?.swaps ?: 0,
            firstPeerAt = state?.firstPeerAt ?: 0L, firstPayloadAt = state?.firstPayloadAt ?: 0L,
            turbo = turboAllowed(hash), earlyBytes = state?.earlyBytes ?: 0L, earlyFailures = state?.earlyFailures ?: 0)
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
     * مصدر معاينة الشريط (طلب المالك 15 نوفمبر: صور لما قدّامك لا لما مررت عليه فقط). قارئ ثانٍ لا يحرّك نافذة المشاهدة
     * ولا مواعيدها: يطلب القطعة التي يحتاجها إطار المعاينة بأولوية أدنى من النافذة، وينتظرها مهلة قصيرة ثم يتخلى.
     * يعمل فقط والحلقة نفسها تُشاهد (لا يفتح تورنتًا ولا يختار ملفًا).
     */
    fun previewDataSourceFactory(delegate: DataSource.Factory): DataSource.Factory = TorrentDataSource.Factory(this, delegate, preview = true)

    internal fun acquirePreview(uri: Uri, cancelled: () -> Boolean): Lease {
        if (uri.scheme != SCHEME || uri.path != "/file") throw IOException("Invalid torrent playback ticket")
        val ticket = tickets[uri.host] ?: throw IOException("Torrent playback ticket expired")
        val state = states[ticket.request.infoHash] ?: throw IOException("Torrent is not playing")
        val (file, pieceLength) = state.retainForPreview() ?: throw IOException("Torrent is not playing")
        return Lease(state, file, pieceLength, { shutdown.get() || cancelled() }, preview = true)
    }
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
            if (request.infoHash in permanentActive) throw IOException("TORRENT_BUSY")
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
            background.remove(request.infoHash)
            // التشغيل بدأ: التسخين الخلفي كله يهدأ (لا يزاحم المختار)، بقطع أو بلا قطع
            val bg = background.keys.toList().also { background.clear() }
            warming.remove(request.infoHash)
            bg + warming.keys.filter { (states[it]?.warmedPieces ?: 0) > 0 }.onEach { warming.remove(it) }
        }
        for (hash in others) states[hash]?.let { other -> runCatching { pruner.execute { runCatching { other.cool() } } } }
        return try {
            tuneConnectTimeout()
            val handle = state.handle(stopped, request)
            // مشغّل حقيقي: بلا حد اتصالات التسخين المسبق، ويعمل حتى لو أوقفه تسخين/خمول سابق قبل اكتمال metadata
            runCatching { handle.swig().set_max_connections(-1); handle.setDownloadLimit(-1) }
            resumeAnnounced(handle)
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
        val selected = try { TorrentPolicy.selectFile(files, request.fileIdx, request.episode, request.filename) } catch (e: IllegalArgumentException) {
            throw IOException(if (e.message == "EPISODE_NOT_IN_TORRENT") "EPISODE_NOT_IN_TORRENT" else "Requested torrent file is not a playable video")
        }
        // Reject escaping paths anywhere in the pack, not just the chosen video.
        for (index in 0 until storage.numFiles()) {
            val target = File(state.folder, storage.filePath(index)).canonicalFile
            if (!target.path.startsWith(state.folder.canonicalPath + File.separator) || storage.fileAbsolutePath(index) || storage.fileFlags(index).and_(FileStorage.FLAG_SYMLINK).nonZero()) throw IOException("Unsafe torrent file path")
        }
        return selected
    }
    internal inner class Lease(private val state: State, val file: TorrentFile, val pieceLength: Int, private val cancelled: () -> Boolean, private val preview: Boolean = false) {
        private val closed = AtomicBoolean(false)
        /**
         * الخيار B لهذا الفتح ([TurboRead]): أول القطع المختلفة التي يقرؤها (رأس الملف أو موضع القفزة، وما بعد مرفقات
         * MKV) حتى سقف البايتات ([TurboRead.piecesPerOpen]) وحدها تُقرأ قبل التحقق. الفتح يبقى طوال التشغيل المتصل، فما
         * بعدها موثق دائمًا.
         */
        private val firstLimit = TurboRead.piecesPerOpen(pieceLength)
        private val firstPieces = ArrayList<Int>(firstLimit)
        private var earlyLeft = if (preview) 0L else TurboRead.MAX_BYTES_PER_OPEN
        /** القراءة من القرص والإغلاق تحت قفل واحد: الإغلاق من خيط آخر ينتظر قراءة جارية (ملّي ثوانٍ من ذاكرة النظام). */
        private val diskLock = Any()
        private var disk: java.io.RandomAccessFile? = null
        private fun earlyAsk(plan: PieceRead): TurboAsk? {
            if (plan.piece !in firstPieces && firstPieces.size < firstLimit) firstPieces += plan.piece
            if (earlyLeft <= 0 || plan.piece !in firstPieces || !turboAllowed(state.infoHash)) return null
            return TurboAsk(plan.offset, minOf(plan.length.toLong(), earlyLeft).toInt())
        }
        /** [length] بايت من الملف عند [position] كما كُتبت على القرص؛ أقل إن لم يعطها القرص (لا يُرمى خطأ: يرجع للموثق). */
        private fun readWritten(position: Long, target: ByteArray, offset: Int, length: Int): Int = synchronized(diskLock) {
            if (closed.get()) return@synchronized 0
            try {
                val raf = disk ?: java.io.RandomAccessFile(File(state.folder, file.path), "r").also { disk = it }
                raf.seek(position)
                var done = 0
                while (done < length) { val n = raf.read(target, offset + done, length - done); if (n <= 0) break; done += n }
                done
            } catch (_: IOException) { 0 }
        }
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
            if (preview) {
                val bytes = state.previewPiece(plan.piece) { closed.get() || cancelled() }
                if (plan.offset + plan.length > bytes.size) throw IOException("Verified piece shorter than selected file range")
                bytes.copyInto(target, offset, plan.offset, plan.offset + plan.length)
                return plan.length
            }
            state.prioritize(file, position, pieceLength)
            val stop = { closed.get() || cancelled() }
            val ask = earlyAsk(plan)
            // null: كتل متصلة من الموضع مكتوبة قبل أن تكتمل القطعة الموثقة ([TurboRead])
            val verified = state.piece(plan.piece, stop, ask)
            val early = if (verified == null && ask != null) readWritten(position, target, offset, ask.span) else 0
            val length = if (early > 0) {
                earlyLeft -= early
                state.earlyRead(early)
                early
            } else {
                // القرص لم يعطِ ما أعلن libtorrent كتابته: هذا الفتح موثق فقط من الآن
                if (verified == null) earlyLeft = 0
                val bytes = verified ?: state.piece(plan.piece, stop) ?: throw IOException("Torrent piece unavailable")
                if (plan.offset + plan.length > bytes.size) throw IOException("Verified piece shorter than selected file range")
                // القطعة التالية تُقرأ من القرص إلى الذاكرة إن اكتملت، قبل أن يصل إليها المشغّل
                if (!legacyWindow) state.readAhead(plan.piece + 1, file, pieceLength)
                bytes.copyInto(target, offset, plan.offset, plan.offset + plan.length)
                plan.length
            }
            if (head != null) {
                val before = head.skip
                head.feed(position, target, offset, length)
                // عُرفت المرفقات للتو: النافذة تقفز إلى ما بعدها فلا تُنزَّل قطعها
                head.skip?.takeIf { before == null }?.let { state.prioritize(file, it.last + 1, pieceLength) }
            }
            return length
        }
        fun close() {
            if (!closed.compareAndSet(false, true)) return
            synchronized(diskLock) { runCatching { disk?.close() }; disk = null }
            state.drop()
        }
    }
    internal inner class State(private val hash: String) {
        val infoHash: String get() = hash
        val folder = File(File(directory, hash), "payload").apply { mkdirs() }
        private val monitor = Object()
        private var refs = 0
        private var initialized = false
        private var starting = false
        private var selected: Int? = null
        private var edgesWanted = false
        private var torrent: TorrentHandle? = null
        private var window = emptyList<Int>()
        /** تركيز البدء ([TorrentPolicy.focusStart]) فعّال الآن، وآخر موضع طلبه المشغّل لفتح النافذة بعده. */
        private var focused = false
        private var lastPosition = 0L
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
        /** للتشخيص: كم مشاركًا بطيئًا حُجب مؤقتًا لتتحرر قطعة عالقة. */
        @Volatile var swaps = 0
        /** خط البدء (elapsedRealtime): أول مشارك متصل وأول بيانات من الشبكة لهذا التورنت. */
        @Volatile var firstPeerAt = 0L; private set
        @Volatile var firstPayloadAt = 0L; private set
        /** يُستدعى أثناء انتظار القطعة فقط حتى يُعرف الاثنان، فلا كلفة بعدها. */
        fun sampleStart(handle: TorrentHandle) {
            if (firstPeerAt != 0L && firstPayloadAt != 0L) return
            val st = runCatching { handle.status() }.getOrNull() ?: return
            val now = android.os.SystemClock.elapsedRealtime()
            if (firstPeerAt == 0L && st.numPeers() > 0) firstPeerAt = now
            if (firstPayloadAt == 0L && st.totalPayloadDownload() > 0) firstPayloadAt = now
        }
        /** بنية بداية ملف MKV كما مرّت بالقارئ؛ null لغير MKV. */
        @Volatile var head: MkvHead? = null; private set
        // ── الخيار B ([TurboRead]) ──
        /**
         * كتل القطع الناقصة كما أعلن libtorrent كتابتها (block_finished_alert)، تُمحى عند تحقق القطعة أو فشله. القطع ذات
         * الموعد (المنتظرة والطرفان) تُتتبع دائمًا، وغيرها حتى [MAX_TRACKED_PIECES]: مع مئات الاتصالات تزيد القطع الجزئية.
         */
        private val written = HashMap<Int, java.util.BitSet>()
        /** قطع سُمح بالقراءة منها قبل التحقق ولم يُحسم تحققها بعد (تُسجَّل لحظة السماح، قبل القراءة من القرص). */
        private val earlyPieces = HashSet<Int>()
        private var lastPiece = -1
        private var lastPieceBytes = 0
        /** للتشخيص: ما قُرئ قبل التحقق، وكم قطعة منه فشل تحققها. */
        @Volatile var earlyBytes = 0L; private set
        @Volatile var earlyFailures = 0; private set
        private fun pieceSizeOf(piece: Int): Int = when {
            pieceLength <= 0 || piece < 0 || piece > lastPiece -> 0
            piece == lastPiece -> lastPieceBytes
            else -> pieceLength
        }
        fun blockWritten(piece: Int, block: Int) = synchronized(monitor) {
            if (!TurboRead.validBlock(block, pieceSizeOf(piece))) return@synchronized
            if (piece !in written && piece !in deadlined && written.size >= MAX_TRACKED_PIECES) return@synchronized
            written.getOrPut(piece) { java.util.BitSet() }.set(block)
            monitor.notifyAll()
        }
        fun pieceVerified(piece: Int) = synchronized(monitor) { written.remove(piece); earlyPieces.remove(piece); Unit }
        /** فشل تحقق [piece]: libtorrent يعيد تنزيل كتلها. true إن كان المشغّل قد قرأ منها قبل التحقق. */
        fun hashFailed(piece: Int): Boolean = synchronized(monitor) {
            written.remove(piece)
            earlyPieces.remove(piece).also { if (it) earlyFailures++ }
        }
        fun earlyRead(bytes: Int) = synchronized(monitor) { earlyBytes += bytes; Unit }
        val fileBytes: Long get() = file?.size ?: 0L
        val pieceBytes: Int get() = pieceLength
        /** للتشخيص: متى صارت بيانات التورنت جاهزة، وأي قطعة ينتظرها القارئ الآن ومنذ متى (elapsedRealtime). */
        @Volatile var metadataAt = 0L; private set
        @Volatile var waitingPiece = -1; private set
        @Volatile var waitingSince = 0L; private set
        fun metadataReady() { if (metadataAt == 0L) metadataAt = android.os.SystemClock.elapsedRealtime() }
        fun retain() = synchronized(monitor) { refs++; idleAt = Long.MAX_VALUE }
        /** قارئ معاينة: فقط والمشاهدة قائمة (قارئ حقيقي اختار الملف)، فلا يُبدأ تورنت ولا يُعاد اختيار. */
        fun retainForPreview(): kotlin.Pair<TorrentFile, Int>? = synchronized(monitor) {
            val f = file
            if (refs == 0 || f == null || pieceLength <= 0 || torrent == null) null else { refs++; idleAt = Long.MAX_VALUE; f to pieceLength }
        }
        /**
         * قطعة لإطار معاينة: أولوية FIVE بلا موعد (النافذة 6-7 بمواعيد تسبقها دائمًا، وما قدّامها 4)، ولا إعادة بناء لمنطقة
         * مفرّغة، ومهلة قصيرة. القطعة المنزّلة تبقى على القرص، فالرجوع للمعاينة نفسها فوري.
         */
        fun previewPiece(piece: Int, cancelled: () -> Boolean): ByteArray {
            val start = android.os.SystemClock.elapsedRealtime()
            synchronized(monitor) {
                val handle = torrent ?: throw IOException("Torrent session ended")
                if (evicted(piece)) throw IOException("Preview piece was evicted")
                if (!handle.havePiece(piece) && piece !in deadlined && piece !in window && piece !in aheadRange) handle.piecePriority(piece, Priority.FIVE)
                while (true) {
                    checkCancelled(cancelled)
                    pieces[piece]?.let { return it }
                    if (refs == 0) throw InterruptedIOException("Torrent has no active reader")
                    if (failed.remove(piece)) throw IOException("Torrent piece read failed")
                    if (handle.havePiece(piece) && reading.add(piece)) handle.readPiece(piece)
                    if (android.os.SystemClock.elapsedRealtime() - start >= PREVIEW_WAIT_MS) throw IOException("Preview piece timed out")
                    try { monitor.wait(100) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); throw InterruptedIOException("Torrent read interrupted") }
                }
            }
        }
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
        /** المسخَّن لا يأخذ اتصالات المشغّل (الحد العام 96)، والخلفي سرعته محدودة أيضًا ([rate] بايت/ث، -1 بلا حد). */
        fun limitWhileWarm(handle: TorrentHandle, rate: Int = -1) = synchronized(monitor) {
            if (refs == 0) runCatching {
                handle.swig().set_max_connections(if (rate > 0) BACKGROUND_CONNECTIONS else PREFETCH_CONNECTIONS)
                handle.setDownloadLimit(rate)
            }
        }
        fun prefetched(file: TorrentFile, info: TorrentInfo, pieces: List<Int>) = synchronized(monitor) {
            // المشغّل سبقنا إليه (أو أُعيد البناء): هو صاحب الأولويات الآن
            if (refs > 0) return@synchronized
            val current = torrent?.takeIf { it.isValid } ?: return@synchronized
            select(current, file, info, fetchEdges = false)
            // أول قطعة وحدها بموعد فوري، والذيل (أو موضع الاستئناف) بأولوية أقل بلا موعد: ينزل بما يفيض عن الرأس.
            // المالك يضغط غالبًا بعد 2–6 ث من فتح الورقة؛ كان الذيل يقاسم الرأس السرعة في هذه الثواني
            pieces.firstOrNull()?.let { head ->
                current.piecePriority(head, Priority.SEVEN)
                current.setPieceDeadline(head, 0)
                deadlined += head
            }
            for (piece in pieces.drop(1)) current.piecePriority(piece, Priority.FIVE)
            warmedAt = android.os.SystemClock.elapsedRealtime(); warmedPieces = pieces.size
            current.unsetFlags(TorrentFlags.STOP_WHEN_READY)
            current.resume()
        }
        fun handle(cancelled: () -> Boolean, request: TorrentRequest): TorrentHandle {
            synchronized(monitor) {
                if (hash in permanentActive || states[hash] !== this) throw IOException("TORRENT_BUSY")
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
                selected = file.index; initialized = true; window = emptyList(); focused = false; aheadRange = IntRange.EMPTY; edgesWanted = false; firstPieceAt = 0L
                head = if (file.path.endsWith(".mkv", ignoreCase = true)) MkvHead() else null
                this.file = file; pieceLength = info.pieceLength()
                lastPiece = info.numPieces() - 1; lastPieceBytes = if (lastPiece >= 0) info.pieceSize(lastPiece) else 0
                written.clear(); earlyPieces.clear()
                val metadata = File(folder.parentFile, "metadata.torrent")
                if (!metadata.isFile) runCatching { metadata.writeBytes(info.bencode()) }
            }
            if (fetchEdges && !edgesWanted) {
                // Container index lives at the head or the tail: fetch both before the extractor asks,
                // time-critical from the moment metadata exists (head first, then the tail).
                val edges = TorrentPolicy.edges(file, info.pieceLength())
                val deferred = hash in tailDeferred
                for ((piece, deadline) in TorrentPolicy.deadlines(edges.take(1), if (deferred) emptyList() else edges.drop(1))) {
                    handle.piecePriority(piece, if (deadline == 0) Priority.SEVEN else Priority.SIX)
                    handle.setPieceDeadline(piece, deadline)
                    deadlined += piece
                }
                // بلا فهرس: الذيل ينزل بما يفيض عن الرأس، بلا موعد يقاسمه السرعة
                if (deferred) for (piece in edges.drop(1)) if (!handle.havePiece(piece)) handle.piecePriority(piece, Priority.FOUR)
                edgesWanted = true
            }
        }
        fun prioritize(file: TorrentFile, position: Long, pieceLength: Int) = synchronized(monitor) {
            val full = TorrentPolicy.window(file, position, pieceLength)
            // رجوع لمنطقة فُرّغت من القرص: libtorrent يقرأها أصفارًا، فنعيد البناء أولًا
            if (full.isNotEmpty() && evicted(full.first())) rebuild()
            val handle = torrent ?: throw IOException("Torrent session ended")
            lastPosition = position
            val focus = PATCHED && TorrentPolicy.focusStart(full, window, focused, full.isNotEmpty() && handle.havePiece(full.first()), CRITICAL_PIECES)
            // في التركيز تُطبَّق القطع ذات الموعد وحدها؛ النافذة كاملة تُفتح حين تكتمل القطعة المنتظرة
            // القطع الكبيرة (≥4MB): القطعة المنتظرة وحدها، فالثانية (16MB في Reacher) كانت تقاسم الرأس السرعة
            val next = if (focus) full.take(TorrentPolicy.focusPieces(pieceLength, CRITICAL_PIECES)) else full
            if (next == window && focus == focused) return@synchronized
            if (directory.usableSpace < MIN_FREE_BYTES || allocatedBytes(folder) > MAX_ACTIVE_BYTES) throw IOException("Insufficient torrent cache space")
            // طرفا الملف لم يكتملا بعد (المستخرج يقفز إلى الفهرس قبل أول إطار): يبقيان بموعد قريب
            val tailWaits = hash in tailDeferred
            val pending = if (tailWaits) emptyList() else TorrentPolicy.edges(file, pieceLength).filter { it !in next && !handle.havePiece(it) }
            // مع libtorrent المخصص: قطعتان فقط بموعد (libtorrent يرفع كل قطعة بموعد إلى الأولوية 7 فيقسم السرعة عليها)،
            // وبقية النافذة أولوية 6 بلا موعد. المكتبة الأصلية: النافذة كلها كما كانت (القياس: الضيقة وحدها لا تفيدها).
            val critical = if (PATCHED) next.take(CRITICAL_PIECES) else next
            val wanted = TorrentPolicy.deadlines(critical, pending)
            if (!diffDeadlines) {
                window.filterNot { it in next }.forEach { handle.piecePriority(it, Priority.IGNORE) }
                handle.clearPieceDeadlines()
                for ((piece, deadline) in wanted) {
                    handle.piecePriority(piece, if (deadline == 0) Priority.SEVEN else Priority.SIX)
                    handle.setPieceDeadline(piece, deadline)
                }
                deadlined = wanted.mapTo(HashSet()) { it.first }
            } else {
                val diff = TorrentPolicy.deadlineDiff(deadlined, wanted)
                // إلغاء الموعد أولًا: libtorrent يعيد أولوية القطعة إلى 1 عند إلغائه، فالتجاهل يأتي بعده وإلا
                // بقيت القطع خلف المشغّل تُنزَّل بأولوية منخفضة
                for (piece in diff.reset) handle.resetPieceDeadline(piece)
                window.filterNot { it in next || it in diff.keep }.forEach { handle.piecePriority(it, Priority.IGNORE) }
                for ((piece, deadline) in diff.set) {
                    handle.piecePriority(piece, if (deadline == 0) Priority.SEVEN else Priority.SIX)
                    handle.setPieceDeadline(piece, deadline)
                }
                deadlined = HashSet(diff.keep)
                for (piece in next) if (piece !in diff.keep) handle.piecePriority(piece, Priority.SIX)
            }
            if (focus) { for (p in aheadRange) if (p !in next) handle.piecePriority(p, Priority.IGNORE); aheadRange = IntRange.EMPTY }
            else extendAhead(handle, file, pieceLength, next)
            // بلا فهرس: الذيل يبقى مطلوبًا بأولوية أقل لأول قفزة (إلغاء النافذة القديمة لا يمسّه)
            if (tailWaits) for (piece in TorrentPolicy.edges(file, pieceLength).drop(1)) if (piece !in next && !handle.havePiece(piece)) handle.piecePriority(piece, Priority.FOUR)
            window = next
            focused = focus
        }

        /** القطعة المنتظرة في التركيز اكتملت: تُفتح النافذة كاملة قبل أن يطلب المشغّل ما بعدها. */
        private fun widenIfReady(handle: TorrentHandle) {
            val head = window.firstOrNull() ?: return
            val f = file ?: return
            if (focused && handle.havePiece(head)) runCatching { prioritize(f, lastPosition, pieceLength) }
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
            window = emptyList(); aheadRange = IntRange.EMPTY; focused = false
            reading.clear(); failed.clear(); written.clear(); earlyPieces.clear()
            for (p in evictedFrom until evictedUntil) pieces.remove(p)?.let { memoryBytes -= it.size }
            evictedFrom = Int.MAX_VALUE; evictedUntil = 0
        }
        /**
         * القطعة الموثقة، أو null حين يُسمح بالقراءة المبكرة ([early]) وكُتبت كتل متصلة من موضعها قبلها
         * (يُملأ [TurboAsk.span] والقارئ يقرؤها من القرص).
         */
        fun piece(piece: Int, cancelled: () -> Boolean, early: TurboAsk? = null): ByteArray? {
            val start = System.nanoTime()
            var progressAt = start
            var checkedAt = 0L
            var swappedAt = 0L
            var done = -1L
            try { synchronized(monitor) {
                while (true) {
                    checkCancelled(cancelled)
                    pieces[piece]?.let { return it }
                    if (early != null && hash !in verifiedOnly) {
                        val span = TurboRead.writtenSpan(written[piece], early.offset, early.length, pieceSizeOf(piece))
                        // تُسجَّل قبل أن تُقرأ: فشل تحقق يصل بين هذا السطر والقراءة من القرص يُكشف ولا يمر
                        if (span > 0) { early.span = span; earlyPieces.add(piece); return null }
                    }
                    if (waitingPiece != piece) { waitingPiece = piece; waitingSince = android.os.SystemClock.elapsedRealtime() }
                    if (refs == 0) throw InterruptedIOException("Torrent has no active reader")
                    if (evicted(piece)) rebuild()
                    if (failed.remove(piece)) throw IOException("Torrent piece read failed")
                    val handle = torrent ?: throw IOException("Torrent session ended")
                    if (handle.status().errorCode().value() != 0) throw IOException("Torrent host/download failure")
                    if (handle.havePiece(piece) && reading.add(piece)) handle.readPiece(piece)
                    widenIfReady(handle)
                    sampleStart(handle)
                    // A 4K piece can be 16 MB: fail on a stalled swarm, not on a slow but moving one.
                    // البايتات الواصلة لا القطع المكتملة: بسرعة 6 Mbps وقطع كبيرة لا تكتمل قطعة خلال 30 ث
                    // والتحميل مستمر، فكان يُحكم بالتوقف ويفشل التشغيل («try another source»).
                    val now = System.nanoTime()
                    if (now - checkedAt >= ONE_SECOND_NS) {
                        checkedAt = now
                        val total = runCatching { handle.status().totalPayloadDownload() }.getOrDefault(done)
                        if (total > done) { if (done >= 0) progressAt = now; done = total }
                        // القطعة المنتظرة عالقة عند مشارك بطيء: يُحجب مؤقتًا فتُطلب كتلته من أسرع (TorrentHotswap)
                        val waited = android.os.SystemClock.elapsedRealtime() - waitingSince
                        // مع libtorrent المخصص يعالج التعديلان 0001/0002 الكتلة العالقة داخل المحرك بلا قطع اتصال؛ حجب المشارك
                        // 60 ث هنا يُسقط كل كتله الجارية فتُطلب من جديد. عينات الجهاز (26 نوفمبر): أبطأ بدايتين (3.8 ث من أول
                        // بيانات إلى أول قطعة) كانتا مع حجب 2 و3 مشاركين. يبقى للمكتبة الأصلية فقط.
                        if (!PATCHED && waited >= TorrentHotswap.WAIT_MS && now - swappedAt >= 2 * ONE_SECOND_NS) {
                            val victims = runCatching {
                                val list = com.frostwire.jlibtorrent.swig.peer_info_vector()
                                handle.swig().get_peer_info(list)
                                TorrentHotswap.victims((0 until list.size).map { list.get(it).let { p ->
                                    TorrentHotswap.Peer(p.getIp().address().to_string(), p.getDownloading_piece_index(), p.getPayload_down_speed())
                                } }, piece, waited)
                            }.getOrDefault(emptyList())
                            if (victims.isNotEmpty()) { swappedAt = now; swaps += victims.size; hotswap(victims) }
                        }
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
            torrent = null; pieces.clear(); reading.clear(); failed.clear(); written.clear(); earlyPieces.clear(); memoryBytes = 0
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
        /** تنزيل دائم بلا أي تقدّم ثلاث دقائق: يُبلَّغ بسببه (لا مشاركين) بدل انتظار بلا نهاية. */
        const val PERMANENT_STALL_MS = 3 * 60_000L
        const val SCHEME = "vantara-torrent"
        /** libtorrent مخصص بتعديلي VANTARA (0001 و0002) مربوط في هذا البناء؛ بدونه يبقى السلوك الأصلي حرفيًا. */
        val PATCHED: Boolean = com.vantara.app.BuildConfig.VANTARA_PATCHED_TORRENT
        internal const val CRITICAL_PIECES = 2
        internal const val STALL_CAP_MS = 1000
        internal const val HEDGE_MS = 750
        private const val MAX_PIECE_BYTES = 16 * 1024 * 1024
        /** قطع ناقصة بلا موعد تُتتبع كتلها للخيار B في وقت واحد (ذوات الموعد تُتتبع دائمًا). */
        private const val MAX_TRACKED_PIECES = 64
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
        /** مهلة قطعة معاينة الشريط: إطار لا يصل خلالها يُترك ويُعاد لاحقًا، والمشاهدة لا تنتظره. */
        private const val PREVIEW_WAIT_MS = 25_000L
        private const val IDLE_GRACE_MS = 20_000L
        private const val ONE_SECOND_NS = 1_000_000_000L
        private const val PREFETCH_HOLD_MS = 90_000L
        private const val PREFETCH_CONNECTIONS = 24
        private const val CONNECT_TIMEOUT_UNMETERED_S = 3
        private const val CONNECT_TIMEOUT_METERED_S = 15
        private const val BACKGROUND_CONNECTIONS = 12
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
            if (PATCHED) {
                // المتغير H في tools/libtorrent-patches (6 تشغيلات): أول قطعة بوسيط 4.3 ث وأقصى 6 بدل 8.8 وأقصى 10.
                // الأولوية تُحترم من أول طلب (لا اختيار عشوائي لأول 4 قطع). تنبيه: tick_interval لا يسرّع إنقاذ الكتل
                // الحرجة؛ libtorrent يعيد تخطيطها في second_tick مرة كل ثانية مهما كانت الدورة (session_impl.cpp)
                settings.setInteger(settings_pack.int_types.tick_interval.swigValue(), 100)
                settings.setInteger(settings_pack.int_types.initial_picker_threshold.swigValue(), 0)
            }
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
