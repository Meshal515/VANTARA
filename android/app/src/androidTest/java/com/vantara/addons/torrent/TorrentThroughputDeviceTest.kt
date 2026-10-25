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

    private fun torrentio(path: String, label: String, test: (String) -> Boolean): Choice? {
        val c = URL("https://torrentio.strem.fun/stream/$path.json").openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", "Mozilla/5.0"); c.connectTimeout = 15000; c.readTimeout = 15000
        val streams = JSONObject(c.inputStream.bufferedReader().readText()).optJSONArray("streams") ?: JSONArray()
        return (0 until streams.length()).map { streams.getJSONObject(it) }.filter { it.has("infoHash") && test(it.optString("title")) }
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

    @Test fun deliveredThroughputProductionVersusAlternatives() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("opt-in", args.getString("throughput") == "1")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val out = File(context.filesDir, "addon-proof/throughput.json").apply { parentFile!!.mkdirs() }
        val results = JSONArray()
        val choices = listOfNotNull(
            runCatching { torrentio("movie/tt0468569", "4K", { "2160p" in it || "4k" in it.lowercase() }) }.getOrNull(),
            runCatching { torrentio("series/tt0903747:1:1", "1080p", { "1080p" in it }) }.getOrNull(),
        )
        // النافذة القديمة مقابل الجديدة، بسرعة الجوال الفعلية في لقطة المستخدم (6 Mbps ≈ 750KB/s) وبلا حد
        val limited = { TorrentEngine.streamingSettings().downloadRateLimit(750 * 1024) }
        val open = { TorrentEngine.streamingSettings() }
        val variants = listOf<Triple<String, () -> SettingsPack, Boolean>>(
            Triple("old@6Mbps", limited, true), Triple("new@6Mbps", limited, false),
            Triple("old@open", open, true), Triple("new@open", open, false),
        )
        for ((i, choice) in choices.withIndex()) {
            // الترتيب يتناوب حتى لا يستفيد بديل واحد من سرب «دافئ»
            val order = variants.indices.map { variants[(it + i) % variants.size] }
            for ((name, settings, legacy) in order) {
                val engine = TorrentEngine(context, sessionSettings = settings, legacyWindow = legacy)
                try { results.put(attempt(engine, choice).put("variant", name)) } finally { engine.close() }
                out.writeText(JSONObject().put("results", results).toString(2))
                Thread.sleep(3000)
            }
        }
        for (r in 0 until results.length()) {
            val o = results.getJSONObject(r)
            println("THROUGHPUT ${o.optString("label")} ${o.optString("variant")} firstByteMs=${o.optLong("firstByteMs")} avgKBps=${o.optLong("avgKBps")} last30KBps=${o.optLong("last30KBps")} peers=${o.optString("peers")} ${o.optString("failure")}")
        }
    }

    private fun attempt(engine: TorrentEngine, choice: Choice): JSONObject {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        File(context.cacheDir, "torrent-streams").deleteRecursively()
        val uri = engine.register(TorrentRequest(choice.hash, choice.fileIdx, choice.sources))
        val result = JSONObject().put("label", choice.label).put("title", choice.title)
        val delivered = AtomicLong(0)
        val firstByte = AtomicLong(-1)
        val begun = SystemClock.elapsedRealtime()
        val source = engine.dataSourceFactory(DefaultDataSource.Factory(context)).createDataSource()
        val reader = Thread {
            runCatching {
                source.open(DataSpec(uri))
                val buffer = ByteArray(256 * 1024)
                while (!Thread.currentThread().isInterrupted) {
                    val n = source.read(buffer, 0, buffer.size)
                    if (n < 0) break
                    if (firstByte.get() < 0) firstByte.set(SystemClock.elapsedRealtime() - begun)
                    delivered.addAndGet(n.toLong())
                }
            }.onFailure { if (!Thread.currentThread().isInterrupted) result.put("failure", it.toString()) }
        }.apply { start() }
        val timeline = JSONArray()
        val perSecond = ArrayList<Long>()
        var last = 0L
        val seconds = 75
        try {
            for (second in 1..seconds) {
                Thread.sleep(1000)
                // نافذة قدّام كما يحسبها المشغّل لفيلم ساعتين
                engine.playback(uri, 1, 2 * 3600_000L)
                val now = delivered.get()
                perSecond += now - last; last = now
                val s = engine.stats(uri)
                timeline.put("${second}s delivered=${(now - (perSecond.dropLast(1).sum())) / 1024}KB rate=${(s?.downloadBytesPerSecond ?: 0) / 1024}KB peers=${s?.peers} seeds=${s?.seeds}")
                if (second == seconds) result.put("peers", "${s?.peers}/${s?.seeds}")
            }
        } finally {
            reader.interrupt(); runCatching { source.close() }; reader.join(5000); engine.release(uri)
        }
        val from = (firstByte.get() / 1000).toInt().coerceIn(0, seconds - 1)
        val active = perSecond.drop(from)
        return result.put("firstByteMs", firstByte.get())
            .put("avgKBps", if (active.isEmpty()) 0 else active.sum() / active.size / 1024)
            .put("last30KBps", perSecond.takeLast(30).sum() / 30 / 1024)
            .put("deliveredMB", delivered.get() / (1024 * 1024))
            .put("timeline", timeline)
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
