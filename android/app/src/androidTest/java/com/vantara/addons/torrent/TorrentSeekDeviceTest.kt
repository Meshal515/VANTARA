package com.vantara.addons.torrent

import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.player.CandidateMediaSources
import com.vantara.anime.player.SeekGuardPlayer
import com.vantara.anime.stream.Candidate
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
 * P0 (المالك، 27 نوفمبر): البدء أقل من ثانية، ثم «تقديم 10 ثوانٍ» يوقف التشغيل وتصير المدة --:--.
 * نفس سلسلة المشغّل: TorrentEngine.dataSourceFactory ← CandidateMediaSources.create(deferCues) ← SeekGuardPlayer، وأول
 * قفزة على مصدر بلا فهرس تعيد تجهيزه بالفهرس كما يفعل PlayerActivity.reprepare. تورنت حقيقي (Torrentio)، ثلاث حالات:
 * بارد (كاش فارغ)، مُسخَّن (TorrentEngine.prefetch قبل الفتح)، مخزّن (الكاش من المرة السابقة). لكل حالة: البدء من 0
 * ثم +10، +10، -10، +10، -10، وسحب إلى 40% ثم 70% ثم 15%؛ والمتابعة من 5:00 بالقفزات نفسها.
 * لكل قفزة: الموضع قبلها والمطلوب، والطريقة (عادية / إعادة تجهيز بالفهرس)، والمدة قبلها وبعدها، ومتى عاد READY وأول
 * إطار، وطلبات القراءة التي فُتحت أثناءها، والقطعة المنتظرة وكتلها، وسبب عدم الاستئناف إن لم يستأنف.
 * Opt-in (-e seekRegression 1): سرب حقيقي.
 */
@RunWith(AndroidJUnit4::class)
class TorrentSeekDeviceTest {
    private data class Choice(val hash: String, val fileIdx: Int?, val sources: List<String>, val title: String)

    private fun torrentio(path: String): Choice? {
        val c = URL("https://torrentio.strem.fun/stream/$path.json").openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", "Mozilla/5.0"); c.connectTimeout = 15000; c.readTimeout = 15000
        val streams = JSONObject(c.inputStream.bufferedReader().readText()).optJSONArray("streams") ?: JSONArray()
        return (0 until streams.length()).map { streams.getJSONObject(it) }
            .filter { it.has("infoHash") && Regex("(?i)\\.mkv|mkv").containsMatchIn(it.optString("title") + it.optString("behaviorHints")) && "1080p" in it.optString("name") + it.optString("title") }
            .maxByOrNull { TorrentPrefetch.seeders(it.optString("title")) ?: 0 }?.let { s ->
                val sources = s.optJSONArray("sources")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
                Choice(s.getString("infoHash"), if (s.has("fileIdx")) s.getInt("fileIdx") else null, sources, s.optString("title").lineSequence().first().take(80))
            }
    }

    @Test fun seeksResumeFromColdWarmAndCachedStarts() {
        assumeTrue("opt-in", InstrumentationRegistry.getArguments().getString("seekRegression") == "1")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val choice = listOf("series/tt9288030:1:1", "series/tt0903747:1:1").firstNotNullOfOrNull { runCatching { torrentio(it) }.getOrNull() } ?: error("no torrent")
        val failures = mutableListOf<String>()
        File(context.cacheDir, "torrent-streams").deleteRecursively()
        // بارد ← مُسخَّن (كاش البارد يُمسح أولًا) ← مخزّن (كاش المُسخَّن يبقى)
        for ((mode, startMs) in listOf("cold" to 0L, "warm" to 0L, "cached" to 0L, "cold-resume" to 300_000L)) {
            if (mode == "warm" || mode == "cold-resume") File(context.cacheDir, "torrent-streams").deleteRecursively()
            val engine = TorrentEngine(context)
            val uri = engine.register(TorrentRequest(choice.hash, choice.fileIdx, choice.sources))
            if (mode == "warm") { engine.prefetch(uri, fetchEdges = true, priority = true); Thread.sleep(20_000) }
            val report = JSONObject().put("mode", mode).put("title", choice.title).put("startMs", startMs)
            failures += runScenario(engine, uri, startMs, report)
            File(context.filesDir, "addon-proof/seeks-$mode.json").apply { parentFile!!.mkdirs() }.writeText(report.toString(2))
            engine.release(uri); engine.close()
        }
        org.junit.Assert.assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    private fun runScenario(engine: TorrentEngine, uri: android.net.Uri, startMs: Long, report: JSONObject): List<String> {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val t0 = SystemClock.elapsedRealtime()
        val opens = JSONArray()
        val total = AtomicLong(0)
        val failures = mutableListOf<String>()
        val consumer = HandlerThread("Frames").apply { start() }
        val images = ImageReader.newInstance(320, 180, ImageFormat.PRIVATE, 3)
        images.setOnImageAvailableListener({ r -> r.acquireLatestImage()?.close() }, Handler(consumer.looper))
        var player: SeekGuardPlayer? = null
        val frames = AtomicLong(0)
        val failure = java.util.concurrent.atomic.AtomicReference("")
        var deferred = false
        val candidate = Candidate(id = "seek-test", sourceId = "torrent", sourceName = "Torrentio", server = "Torrentio", host = "torrent",
            url = uri.toString(), resolvedAt = System.currentTimeMillis(), expiresAt = System.currentTimeMillis() + 3_600_000)
        val factory = engine.dataSourceFactory(DefaultDataSource.Factory(context)).let { base ->
            DataSource.Factory {
                val inner = base.createDataSource()
                object : DataSource by inner {
                    var entry: JSONObject? = null; var read = 0L
                    override fun open(dataSpec: DataSpec): Long {
                        val e = JSONObject().put("t", SystemClock.elapsedRealtime() - t0).put("pos", dataSpec.position)
                        synchronized(opens) { opens.put(e) }; entry = e; read = 0
                        return inner.open(dataSpec)
                    }
                    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                        val n = inner.read(buffer, offset, length)
                        if (n > 0) { read += n; total.addAndGet(n.toLong()); entry?.put("read", read)?.put("last", SystemClock.elapsedRealtime() - t0) }
                        return n
                    }
                    override fun close() { entry?.put("closed", SystemClock.elapsedRealtime() - t0); inner.close() }
                }
            }
        }
        // PlayerActivity.reprepare: المصدر نفسه بالفهرس عند الموضع المطلوب
        fun reprepare(p: ExoPlayer, positionMs: Long) {
            engine.deferTail(uri, false)
            p.setMediaSource(CandidateMediaSources.create(candidate, factory, false, deferCues = false).mediaSource, positionMs)
            p.prepare()
        }
        val seeks = JSONArray()
        try {
            instrumentation.runOnMainSync {
                var guard: SeekGuardPlayer? = null
                val inner = ExoPlayer.Builder(context).setLoadControl(com.vantara.anime.player.PlaybackBuffering.create(Runtime.getRuntime().maxMemory()))
                    .setSeekBackIncrementMs(10_000).setSeekForwardIncrementMs(10_000).build()
                guard = SeekGuardPlayer(inner) { pos ->
                    if (!deferred) false else { deferred = false; if (inner.isCurrentMediaItemSeekable) false else { reprepare(inner, pos); true } }
                }
                player = guard
                guard.setVideoSurface(images.surface)
                guard.addListener(object : Player.Listener {
                    override fun onRenderedFirstFrame() { frames.incrementAndGet() }
                    override fun onPlayerError(e: androidx.media3.common.PlaybackException) { failure.set("${e.errorCodeName}: ${generateSequence<Throwable>(e) { it.cause }.joinToString(" ← ") { "${it.javaClass.simpleName}: ${it.message}" }}") }
                })
                // PlayerActivity.start: من أول الحلقة بلا فهرس، والمتابعة بالفهرس
                deferred = startMs == 0L
                engine.deferTail(uri, deferred)
                guard.setMediaSource(CandidateMediaSources.create(candidate, factory, false, deferCues = deferred).mediaSource, startMs)
                guard.prepare(); guard.playWhenReady = true
            }
            val started = waitFor(player!!, 90_000) { p -> p.playbackState == Player.STATE_READY && frames.get() > 0 }
            report.put("startReadyMs", if (started) SystemClock.elapsedRealtime() - t0 else -1).put("startError", failure.get())
            if (!started) return listOf("${report.getString("mode")}: لم يبدأ خلال 90 ث (${state(player!!, engine, uri)}) ${failure.get()}")
            Thread.sleep(3000)
            val plan: List<Pair<String, (Long, Long) -> Long>> = listOf(
                "+10" to { pos, _ -> pos + 10_000 }, "+10" to { pos, _ -> pos + 10_000 }, "-10" to { pos, _ -> pos - 10_000 },
                "+10" to { pos, _ -> pos + 10_000 }, "-10" to { pos, _ -> pos - 10_000 },
                "40%" to { _, d -> d * 40 / 100 }, "70%" to { _, d -> d * 70 / 100 }, "15%" to { _, d -> d * 15 / 100 },
            )
            for ((label, target) in plan) {
                val entry = JSONObject().put("seek", label)
                var to = 0L
                val opensBefore = synchronized(opens) { opens.length() }
                instrumentation.runOnMainSync {
                    val p = player!!
                    val d = p.duration
                    to = target(p.currentPosition, if (d > 0) d else 0L).coerceAtLeast(0)
                    entry.put("from", p.currentPosition).put("to", to).put("durationBefore", d).put("seekable", p.isCurrentMediaItemSeekable)
                        .put("method", if (deferred && !p.isCurrentMediaItemSeekable) "إعادة تجهيز بالفهرس" else "عادية")
                    frames.set(0)
                    p.seekTo(to)
                }
                val at = SystemClock.elapsedRealtime()
                var lostDurationMs = 0L
                var ok = false
                while (SystemClock.elapsedRealtime() - at < 60_000) {
                    Thread.sleep(200)
                    var done = false
                    instrumentation.runOnMainSync {
                        val p = player!!
                        if (p.duration == C.TIME_UNSET || p.duration <= 0) lostDurationMs += 200
                        done = p.playbackState == Player.STATE_READY && frames.get() > 0 && kotlin.math.abs(p.currentPosition - to) < 15_000
                    }
                    if (done) { ok = true; break }
                    if (failure.get().isNotEmpty()) break
                }
                val took = SystemClock.elapsedRealtime() - at
                instrumentation.runOnMainSync {
                    val p = player!!
                    entry.put("ok", ok).put("ms", took).put("durationAfter", p.duration).put("durationUnknownMs", lostDurationMs)
                        .put("positionAfter", p.currentPosition).put("stateAfter", p.playbackState)
                }
                entry.put("opens", synchronized(opens) { JSONArray((opensBefore until opens.length()).map { opens.get(it) }) })
                if (!ok) {
                    val why = state(player!!, engine, uri) + failure.get().let { if (it.isNotEmpty()) " · خطأ: $it" else "" }
                    entry.put("whyStuck", why)
                    failures += "${report.getString("mode")} ${label}: لم يستأنف خلال ${took / 1000} ث — $why"
                }
                seeks.put(entry)
                println("SEEK ${report.getString("mode")} $label ok=$ok ms=$took durUnknownMs=$lostDurationMs ${entry.optString("whyStuck")}")
                if (!ok) break
                Thread.sleep(2500)
            }
        } finally {
            report.put("seeks", seeks).put("opens", opens).put("error", failure.get())
            runCatching { instrumentation.runOnMainSync { player?.release() } }
            images.close(); consumer.quitSafely()
        }
        return failures
    }

    private fun waitFor(p: Player, ms: Long, test: (Player) -> Boolean): Boolean {
        val until = SystemClock.elapsedRealtime() + ms
        var ok = false
        while (!ok && SystemClock.elapsedRealtime() < until) {
            Thread.sleep(200)
            InstrumentationRegistry.getInstrumentation().runOnMainSync { ok = test(p) }
        }
        return ok
    }

    /** لماذا لم يستأنف: حالة المشغّل والمدة، وما ينتظره المحرك (القطعة وكتلها) وانتظاراته الطويلة. */
    private fun state(p: Player, engine: TorrentEngine, uri: android.net.Uri): String {
        var s = ""
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            s = "state=${p.playbackState} playWhenReady=${p.playWhenReady} pos=${p.currentPosition} dur=${p.duration} seekable=${p.isCurrentMediaItemSeekable} buffered=${p.totalBufferedDuration}"
        }
        val st = engine.stats(uri)
        val blocks = st?.waitingPiece?.takeIf { it >= 0 }?.let { engine.pieceBlocks(uri, it) }
        return s + " · peers=${st?.peers} rate=${st?.downloadBytesPerSecond} waiting=${st?.waitingPiece} blocks=$blocks hints=${st?.hintsSent}/${st?.hintsFailed}" +
            " waits=" + (st?.waits?.joinToString(";") { "p${it.piece}b${it.block} ${it.ms}ms known=${it.known} lt=${it.engine}/${it.blocks} early=${it.early}" } ?: "")
    }
}
