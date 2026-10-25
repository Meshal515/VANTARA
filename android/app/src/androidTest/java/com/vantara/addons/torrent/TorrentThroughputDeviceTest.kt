package com.vantara.addons.torrent

import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.TransferListener
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.frostwire.jlibtorrent.SettingsPack
import com.frostwire.jlibtorrent.swig.settings_pack
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicLong

/**
 * تشخيص: كم بايت يصل للمشغّل فعلًا في الثانية من سرب حقيقي، بإعدادات الإنتاج مقابل بدائل؟
 * قارئ متتابع بأقصى سرعة عبر TorrentDataSource نفسه (كما يملأ المشغّل مخزنه)، بلا فك ترميز
 * (المحاكي لا يفك 4K). الشبكة يُبطئها المحاكي (-netdelay) لتشبه الجوال. Opt-in (-e throughput 1).
 */
@RunWith(AndroidJUnit4::class)
class TorrentThroughputDeviceTest {
    private data class Choice(val label: String, val hash: String, val fileIdx: Int?, val sources: List<String>, val title: String)

    private fun torrentio(path: String, label: String, test: (String) -> Boolean, seeds: IntRange = 1..Int.MAX_VALUE): Choice? {
        val c = URL("https://torrentio.strem.fun/stream/$path.json").openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", "Mozilla/5.0"); c.connectTimeout = 15000; c.readTimeout = 15000
        val streams = JSONObject(c.inputStream.bufferedReader().readText()).optJSONArray("streams") ?: JSONArray()
        return (0 until streams.length()).map { streams.getJSONObject(it) }.filter { it.has("infoHash") && test(it.optString("title")) && (TorrentPrefetch.seeders(it.optString("title")) ?: 0) in seeds }
            .maxByOrNull { TorrentPrefetch.seeders(it.optString("title")) ?: 0 }?.let { s ->
                val sources = s.optJSONArray("sources")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
                Choice(label, s.getString("infoHash"), if (s.has("fileIdx")) s.getInt("fileIdx") else null, sources, s.optString("title").lineSequence().first().take(80) + " " + (s.optString("title").lines().firstOrNull { "👤" in it } ?: ""))
            }
    }

    private fun variant(queueTime: Int?, tcpOnly: Boolean): () -> SettingsPack = {
        TorrentEngine.streamingSettings().apply {
            if (queueTime != null) setInteger(settings_pack.int_types.request_queue_time.swigValue(), queueTime)
            if (tcpOnly) {
                setBoolean(settings_pack.bool_types.enable_outgoing_utp.swigValue(), false)
                setBoolean(settings_pack.bool_types.enable_incoming_utp.swigValue(), false)
            }
        }
    }

    /**
     * القديم مقابل المتكيّف كما يعيشه المشاهد: مشغّل محاكى يستهلك بمعدل الفيديو الفعلي (حجم الملف ÷
     * مدته) ويملأ مخزونًا حتى 120 ث، يبدأ عند 1.5 ث ويستأنف بعد التوقف عند 3 ث (كإعداد ExoPlayer
     * عندنا). يُقاس: متى بدأ، كم مرة توقف، كم ثانية توقف، ومتوسط «جاهز أمامك». ثلاث حالات: سرب كبير
     * على 6 Mbps، سرب كبير بلا حد، وسرب صغير (2–8 زارعين) بلا حد كلقطة المستخدم. كل حالة مرتين.
     */
    @Test fun adaptiveVersusLegacyAsTheViewerSeesIt() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("opt-in", args.getString("throughput") == "1")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val out = File(context.filesDir, "addon-proof/throughput.json").apply { parentFile!!.mkdirs() }
        val results = JSONArray()
        val big4k = runCatching { torrentio("movie/tt0468569", "big-4K", { "2160p" in it || "4k" in it.lowercase() }) }.getOrNull()
        val big1080 = runCatching { torrentio("movie/tt0468569", "big-1080p", { "1080p" in it }) }.getOrNull()
        val small = listOf("movie/tt0468569", "movie/tt0111161", "movie/tt1375666").firstNotNullOfOrNull { path ->
            runCatching { torrentio(path, "small-1080p", { "1080p" in it || "720p" in it }, 2..8) }.getOrNull()
        }
        val limited = { TorrentEngine.streamingSettings().downloadRateLimit(750 * 1024) }
        val open = { TorrentEngine.streamingSettings() }
        // (الحالة، الاختيار، الإعدادات، مدة الفيلم)
        val cases: List<List<Any>> = listOfNotNull(
            big1080?.let { listOf("big@6Mbps", it, limited, 9_120_000L) },
            big4k?.let { listOf("big@open", it, open, 9_120_000L) },
            small?.let { listOf("small@open", it, open, 9_000_000L) },
        )
        for (round in 0 until 2) for ((c, case) in cases.withIndex()) {
            val (name, choice, settings, duration) = case
            val modes = if ((round + c) % 2 == 0) listOf(TorrentWindowMode.LEGACY, TorrentWindowMode.ADAPTIVE) else listOf(TorrentWindowMode.ADAPTIVE, TorrentWindowMode.LEGACY)
            for (mode in modes) {
                @Suppress("UNCHECKED_CAST")
                val engine = TorrentEngine(context, sessionSettings = settings as () -> SettingsPack, windowMode = mode)
                try { results.put(viewer(engine, choice as Choice, duration as Long).put("case", name).put("mode", mode.name).put("round", round)) } finally { engine.close() }
                out.writeText(JSONObject().put("results", results).toString(2))
                Thread.sleep(3000)
            }
        }
        for (r in 0 until results.length()) {
            val o = results.getJSONObject(r)
            println("VIEWER ${o.optString("case")} r${o.optInt("round")} ${o.optString("mode").padEnd(8)} startMs=${o.optLong("startMs")} stalls=${o.optInt("stalls")} stalledS=${o.optLong("stalledMs") / 1000} avgAheadS=${o.optLong("avgAheadMs") / 1000} torrentKBps=${o.optLong("torrentKBps")} needKBps=${o.optLong("needKBps")} peers=${o.optString("peers")} ${o.optString("failure")}")
        }
    }

    private fun viewer(engine: TorrentEngine, choice: Choice, durationMs: Long): JSONObject {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        File(context.cacheDir, "torrent-streams").deleteRecursively()
        val uri = engine.register(TorrentRequest(choice.hash, choice.fileIdx, choice.sources))
        val result = JSONObject().put("title", choice.title)
        val delivered = AtomicLong(0)
        val consumed = AtomicLong(0)
        val videoRate = AtomicLong(0) // بايت/ث للفيديو، يُعرف بعد اختيار الملف
        val begun = SystemClock.elapsedRealtime()
        val source = engine.dataSourceFactory(DefaultDataSource.Factory(context)).createDataSource()
        val reader = Thread {
            runCatching {
                source.open(DataSpec(uri))
                val buffer = ByteArray(256 * 1024)
                while (!Thread.currentThread().isInterrupted) {
                    // مخزون المشغّل ممتلئ (120 ث): يتوقف عن الطلب كما يفعل ExoPlayer
                    if (videoRate.get() > 0 && delivered.get() - consumed.get() >= videoRate.get() * 120) { Thread.sleep(50); continue }
                    val n = source.read(buffer, 0, buffer.size)
                    if (n < 0) break
                    delivered.addAndGet(n.toLong())
                }
            }.onFailure { if (!Thread.currentThread().isInterrupted) result.put("failure", it.toString()) }
        }.apply { start() }
        var playing = false
        var startMs = -1L
        var stalls = 0
        var stalledMs = 0L
        var aheadSum = 0L
        var aheadSamples = 0
        val torrentRates = ArrayList<Long>()
        val timeline = JSONArray()
        val seconds = 120
        try {
            for (tick in 1..seconds * 4) {
                Thread.sleep(250)
                if (videoRate.get() == 0L) engine.stats(uri)?.fileBytes?.takeIf { it > 0 }?.let { videoRate.set(it * 1000 / durationMs) }
                val rate = videoRate.get()
                if (rate == 0L) continue
                if (playing) {
                    val step = rate / 4
                    val room = delivered.get() - consumed.get()
                    consumed.addAndGet(minOf(step, room))
                    if (room <= step) { playing = false; stalls++ }
                } else {
                    val bufferedMs = (delivered.get() - consumed.get()) * 1000 / rate
                    if (bufferedMs >= if (startMs < 0) 1_500 else 3_000) { playing = true; if (startMs < 0) startMs = SystemClock.elapsedRealtime() - begun }
                }
                if (!playing && startMs >= 0) stalledMs += 250
                if (tick % 4 == 0) {
                    val aheadMs = (delivered.get() - consumed.get()) * 1000 / rate
                    if (startMs >= 0) { aheadSum += aheadMs; aheadSamples++ }
                    engine.playback(uri, consumed.get() * 1000 / rate, durationMs, aheadMs)
                    val s = engine.stats(uri)
                    torrentRates += (s?.downloadBytesPerSecond ?: 0) / 1024
                    timeline.put("${tick / 4}s ahead=${aheadMs / 1000}s playing=$playing torrent=${(s?.downloadBytesPerSecond ?: 0) / 1024}KB peers=${s?.peers}")
                    if (tick == seconds * 4) result.put("peers", "${s?.peers}/${s?.seeds}")
                }
            }
        } finally {
            reader.interrupt(); runCatching { source.close() }; reader.join(5000); engine.release(uri)
        }
        // لم يبدأ أبدًا: كل المدة توقف
        if (startMs < 0) stalledMs = seconds * 1000L
        return result.put("startMs", startMs).put("stalls", stalls).put("stalledMs", stalledMs)
            .put("avgAheadMs", if (aheadSamples == 0) 0 else aheadSum / aheadSamples)
            .put("torrentKBps", if (torrentRates.isEmpty()) 0 else torrentRates.drop(10).average().toLong())
            .put("needKBps", videoRate.get() / 1024).put("timeline", timeline)
    }

    /**
     * تسلسل بدء حقيقي بإعدادات الإنتاج: أول قطعة ← أول بايت للمشغّل ← READY ← أول إطار، بلا
     * ضغط تشغيل (play مرة واحدة كما يفعل المشغّل عند الفتح). ثم قفزة لمنتصف الفيلم تفرض انتظار
     * تحميل، ويُثبت أن التشغيل يستأنف وحده (isPlaying) دون استدعاء play مرة أخرى.
     */
    @Test fun startupTimelineAndAutoResume() {
        assumeTrue("opt-in", InstrumentationRegistry.getArguments().getString("startup") == "1")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val choice = listOf("movie/tt0468569", "movie/tt0111161").firstNotNullOfOrNull { path ->
            runCatching { torrentio(path, "1080p x264", { "1080p" in it && "x265" !in it.lowercase() && "hevc" !in it.lowercase() && "10bit" !in it.lowercase() }) }.getOrNull()
        } ?: error("no torrent")
        File(context.cacheDir, "torrent-streams").deleteRecursively()
        val engine = TorrentEngine(context)
        val uri = engine.register(TorrentRequest(choice.hash, choice.fileIdx, choice.sources))
        val t0 = SystemClock.elapsedRealtime()
        var firstByte = 0L; var ready = 0L; var frame = 0L
        val events = JSONArray()
        val consumer = HandlerThread("Frames").apply { start() }
        val images = ImageReader.newInstance(320, 180, ImageFormat.PRIVATE, 3)
        images.setOnImageAvailableListener({ r -> r.acquireLatestImage()?.close() }, Handler(consumer.looper))
        var player: ExoPlayer? = null
        val bytes = object : TransferListener {
            override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
            override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
            override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, n: Int) { if (firstByte == 0L && n > 0) firstByte = SystemClock.elapsedRealtime() }
            override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
        }
        val result = JSONObject().put("title", choice.title)
        try {
            instrumentation.runOnMainSync {
                val base = engine.dataSourceFactory(DefaultDataSource.Factory(context))
                val factory = DataSource.Factory { base.createDataSource().also { it.addTransferListener(bytes) } }
                val p = ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(factory))
                    .setLoadControl(com.vantara.anime.player.PlaybackBuffering.create(Runtime.getRuntime().maxMemory())).build()
                player = p; p.setVideoSurface(images.surface)
                p.addListener(object : Player.Listener {
                    override fun onRenderedFirstFrame() { if (frame == 0L) frame = SystemClock.elapsedRealtime() }
                    override fun onPlaybackStateChanged(state: Int) {
                        val name = mapOf(1 to "IDLE", 2 to "BUFFERING", 3 to "READY", 4 to "ENDED")[state]
                        events.put("+${SystemClock.elapsedRealtime() - t0}ms $name pos=${p.currentPosition / 1000}s")
                        if (state == Player.STATE_READY && ready == 0L) ready = SystemClock.elapsedRealtime()
                    }
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) { events.put("error ${error.errorCodeName}") }
                })
                p.setMediaItem(MediaItem.fromUri(uri)); p.prepare(); p.playWhenReady = true
            }
            val deadline = t0 + 90_000
            while (frame == 0L && SystemClock.elapsedRealtime() < deadline) Thread.sleep(200)
            Thread.sleep(5000)
            val piece = engine.stats(uri)?.firstPieceAt ?: 0L
            fun rel(t: Long) = if (t > 0) t - t0 else -1
            result.put("firstPieceMs", rel(piece)).put("firstByteMs", rel(firstByte)).put("readyMs", rel(ready)).put("firstFrameMs", rel(frame))
            // قفزة لمنتصف الفيلم: انتظار تحميل ثم استئناف تلقائي
            var seekAt = 0L
            instrumentation.runOnMainSync { player!!.seekTo(player!!.duration / 2); seekAt = SystemClock.elapsedRealtime() }
            var resumedAt = 0L
            while (SystemClock.elapsedRealtime() - seekAt < 90_000) {
                Thread.sleep(250)
                var playing = false
                instrumentation.runOnMainSync { playing = player!!.isPlaying && player!!.currentPosition > player!!.duration / 2 }
                if (playing) { resumedAt = SystemClock.elapsedRealtime(); break }
            }
            var playWhenReady = false
            instrumentation.runOnMainSync { playWhenReady = player!!.playWhenReady }
            result.put("resumeAfterSeekMs", if (resumedAt > 0) resumedAt - seekAt else -1).put("playWhenReady", playWhenReady)
        } finally {
            runCatching { instrumentation.runOnMainSync { player?.release() } }
            images.close(); consumer.quitSafely(); engine.release(uri); engine.close()
        }
        result.put("events", events)
        println("STARTUP ${result.toString().take(3500)}")
        File(context.filesDir, "addon-proof/startup.json").apply { parentFile!!.mkdirs() }.writeText(result.toString(2))
        org.junit.Assert.assertTrue("first frame without pressing play: $result", result.getLong("firstFrameMs") > 0)
        org.junit.Assert.assertTrue("resumed by itself after the buffering wait: $result", result.getLong("resumeAfterSeekMs") > 0)
    }
}
