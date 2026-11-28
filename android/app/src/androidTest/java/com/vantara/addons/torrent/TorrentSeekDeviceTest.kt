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
            // محاكي x86 بلا مفكك HEVC (التشغيل الأول: NO_EXCEEDS_CAPABILITIES في OMX.google.hevc.decoder): H.264 فقط
            .filter { val t = it.optString("name") + " " + it.optString("title")
                it.has("infoHash") && Regex("(?i)mkv").containsMatchIn(t + it.optString("behaviorHints")) && Regex("(?i)x264|h\\.?264|avc").containsMatchIn(t) &&
                    !Regex("(?i)x265|hevc|h\\.?265|10.?bit").containsMatchIn(t) && Regex("1080p|720p").containsMatchIn(t) }
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
        // (الاسم، موضع البدء، امسح الكاش أولًا، سخّن قبل الفتح، المخزن مفعّل، فشل تحقق مصطنع بعد أول قفزة)
        data class Case(val mode: String, val startMs: Long, val clear: Boolean, val warm: Boolean, val chunking: Boolean = true, val failure: Boolean = false)
        val cases = listOf(
            Case("cold", 0, clear = true, warm = false), Case("cold-resume", 300_000, clear = true, warm = false),
            Case("warm", 0, clear = true, warm = true), Case("warm-resume", 300_000, clear = true, warm = true),
            Case("cached", 0, clear = false, warm = false), Case("cached-resume", 300_000, clear = false, warm = false),
            // قبل الإصلاح بالملف نفسه على القرص: كل read إلى المحرك (كم استدعاء وكم زمنًا)
            Case("cached-resume-unbuffered", 300_000, clear = false, warm = false, chunking = false),
            // التعافي: فشل تحقق قطعة قُرئت قبل التحقق، والمشغّل يُعاد تجهيزه من بيانات موثقة ويستمر
            Case("recovery", 0, clear = true, warm = false, failure = true),
        )
        for (c in cases) {
            if (c.clear) File(context.cacheDir, "torrent-streams").deleteRecursively()
            TorrentDataSource.chunking = c.chunking
            val engine = TorrentEngine(context)
            val uri = engine.register(TorrentRequest(choice.hash, choice.fileIdx, choice.sources))
            if (c.warm) { engine.prefetch(uri, fetchEdges = true, priority = true); Thread.sleep(20_000) }
            val report = JSONObject().put("mode", c.mode).put("title", choice.title).put("startMs", c.startMs).put("chunking", c.chunking)
            try { failures += runScenario(engine, uri, c.startMs, report, c.failure) }
            finally { TorrentDataSource.chunking = true }
            File(context.filesDir, "addon-proof/seeks-${c.mode}.json").apply { parentFile!!.mkdirs() }.writeText(report.toString(2))
            println("CASE ${c.mode} startMs=${report.optLong("startReadyMs")} cuesMs=${report.optLong("cuesMs", -1)} engineReads=${report.optLong("engineReads")} cpuMs=${report.optLong("cpuMs")} recovered=${report.optString("recovered")}")
            engine.release(uri); engine.close()
        }
        org.junit.Assert.assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    private fun runScenario(engine: TorrentEngine, uri: android.net.Uri, startMs: Long, report: JSONObject, hashFailure: Boolean = false): List<String> {
        val cpu0 = android.os.Process.getElapsedCpuTime()
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
            // قراءة الفهرس: أول فتح عند آخر 1% من الملف، من فتحه حتى آخر بايت
            synchronized(opens) { (0 until opens.length()).map { opens.getJSONObject(it) } }
                .firstOrNull { it.optLong("pos") > (engine.stats(uri)?.fileBytes ?: Long.MAX_VALUE) * 99 / 100 && it.has("last") }
                ?.let { report.put("cuesMs", it.getLong("last") - it.getLong("t")).put("cuesBytes", it.optLong("read")) }
            // PlayerActivity: أول صورة لمصدر بلا فهرس ← Cues في الخلفية (TorrentEngine.fetchCues)
            if (started && deferred) report.put("fetchCues", engine.fetchCues(uri))
            if (!started) return listOf("${report.getString("mode")}: لم يبدأ خلال 90 ث (${state(player!!, engine, uri)}) ${failure.get()}")
            // التعافي لحظة أول صورة (القطع المقروءة قبل التحقق لم تُحسم بعد): فشل تحقق كما يصل من libtorrent، والمشغّل يُعاد
            // تجهيزه من بيانات موثقة كما PlayerActivity.recoverVerified، ويستمر. ما سُلّم قبله لا يُسترجع: هذا هو مسار التعافي
            if (hashFailure) {
                val early = engine.earlyPiecesOf(uri)
                if (early.isEmpty()) report.put("recovered", "no-early-pieces-at-first-frame")
                else {
                    val recovered = java.util.concurrent.CountDownLatch(1)
                    val listener: (String) -> Unit = { recovered.countDown() }
                    engine.addTurboListener(listener)
                    engine.simulateHashFailure(uri, early.first())
                    val notified = recovered.await(5, java.util.concurrent.TimeUnit.SECONDS)
                    engine.removeTurboListener(listener)
                    var resumeAt = 0L
                    instrumentation.runOnMainSync { resumeAt = player!!.currentPosition; frames.set(0); deferred = false; reprepare(player!!, resumeAt) }
                    val back = waitFor(player!!, 60_000) { p -> p.playbackState == Player.STATE_READY && frames.get() > 0 && p.duration > 0 }
                    var moving = false
                    if (back) { var at0 = 0L; instrumentation.runOnMainSync { at0 = player!!.currentPosition }; Thread.sleep(1500); instrumentation.runOnMainSync { moving = player!!.currentPosition > at0 + 500 } }
                    val turbo = engine.stats(uri)?.turbo
                    report.put("recovered", "earlyPieces=${early.size} notified=$notified back=$back continues=$moving earlyAllowedAfter=$turbo")
                    if (!notified || !back || !moving || turbo != false) failures += "${report.getString("mode")}: التعافي بعد فشل التحقق لم يكتمل (${report.getString("recovered")})"
                }
            }

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
                // التشغيل يستمر بعد القفزة (لا READY فقط): الموضع يتقدم والمدة معروفة
                if (ok) {
                    var before = 0L
                    instrumentation.runOnMainSync { before = player!!.currentPosition }
                    Thread.sleep(1500)
                    var advanced = false; var duration = 0L
                    instrumentation.runOnMainSync { advanced = player!!.currentPosition > before + 500; duration = player!!.duration }
                    entry.put("continues", advanced).put("durationKnown", duration > 0)
                    if (!advanced || duration <= 0) failures += "${report.getString("mode")} $label: لم يستمر التشغيل بعد القفزة (تقدّم=$advanced، المدة=$duration)"
                }
                println("SEEK ${report.getString("mode")} $label ok=$ok ms=$took durUnknownMs=$lostDurationMs continues=${entry.optBoolean("continues")} ${entry.optString("whyStuck")}")
                if (!ok) break
                Thread.sleep(2500)
            }
        } finally {
            report.put("seeks", seeks).put("opens", opens).put("error", failure.get())
                .put("engineReads", engine.stats(uri)?.engineReads ?: -1).put("cpuMs", android.os.Process.getElapsedCpuTime() - cpu0)
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
