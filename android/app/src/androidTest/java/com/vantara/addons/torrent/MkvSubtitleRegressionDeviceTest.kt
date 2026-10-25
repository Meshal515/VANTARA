package com.vantara.addons.torrent

import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
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
 * انحدار: MKV بترجمة مدمجة فيها حروف غير إنجليزية (حلقة The Future Diary الأولى، تورنت حقيقي).
 * Media3 1.5.1 كان يتوقف بـ «Out of range: -46» في ParsableByteArray.peekCharacterAndSize ولا يصل
 * READY أبدًا. Opt-in (-e mkvRegression 1) لأنه يعتمد على سرب حقيقي.
 */
@RunWith(AndroidJUnit4::class)
class MkvSubtitleRegressionDeviceTest {
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

    /**
     * حلقة The Future Diary الأولى كما فتحها المستخدم (نفس الملف، سرب صغير)، بمشغّل ExoPlayer الحقيقي
     * وإعداد التخزين نفسه: مرة من البداية ومرة من 5:01 (موضع لقطة المستخدم). يُسجَّل كل طلب قراءة من
     * المشغّل (من أي بايت وكم قرأ)، والبايتات قبل READY، وهل الملف قابل للقفز، و«جاهز أمامك» كل ثانية.
     */
    @Test fun subtitledMkvReachesReadyFromStartAndResume() {
        assumeTrue("opt-in", InstrumentationRegistry.getArguments().getString("mkvRegression") == "1")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val choice = listOf(2..8, 1..15).firstNotNullOfOrNull { range ->
            runCatching { torrentio("series/kitsu:6266:1", "anime", { !Regex("(?i)batch|complete").containsMatchIn(it) }, range) }.getOrNull()
        } ?: error("no torrent")
        for (startMs in listOf(0L, 301_000L)) {
            File(context.cacheDir, "torrent-streams").deleteRecursively()
            val engine = TorrentEngine(context)
            val uri = engine.register(TorrentRequest(choice.hash, choice.fileIdx, choice.sources))
            val t0 = SystemClock.elapsedRealtime()
            val opens = JSONArray()
            val total = AtomicLong(0)
            var ready = 0L; var frame = 0L; var bytesAtReady = -1L
            val samples = JSONArray()
            val consumer = HandlerThread("Frames").apply { start() }
            val images = ImageReader.newInstance(320, 180, ImageFormat.PRIVATE, 3)
            images.setOnImageAvailableListener({ r -> r.acquireLatestImage()?.close() }, Handler(consumer.looper))
            var player: ExoPlayer? = null
            val result = JSONObject().put("title", choice.title).put("startMs", startMs)
            try {
                instrumentation.runOnMainSync {
                    val base = engine.dataSourceFactory(DefaultDataSource.Factory(context))
                    val factory = DataSource.Factory {
                        val inner = base.createDataSource()
                        object : DataSource by inner {
                            var at = 0L; var read = 0L; var entry: JSONObject? = null
                            override fun open(dataSpec: DataSpec): Long {
                                at = SystemClock.elapsedRealtime() - t0; read = 0
                                val e = JSONObject().put("t", at).put("pos", dataSpec.position).put("len", dataSpec.length)
                                synchronized(opens) { opens.put(e) }; entry = e
                                return inner.open(dataSpec)
                            }
                            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                                val n = inner.read(buffer, offset, length)
                                if (n > 0) { read += n; total.addAndGet(n.toLong()); entry?.put("read", read) }
                                return n
                            }
                        }
                    }
                    val p = ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(factory))
                        .setLoadControl(com.vantara.anime.player.PlaybackBuffering.create(Runtime.getRuntime().maxMemory())).build()
                    player = p; p.setVideoSurface(images.surface)
                    p.addListener(object : Player.Listener {
                        override fun onRenderedFirstFrame() { if (frame == 0L) frame = SystemClock.elapsedRealtime() - t0 }
                        override fun onPlaybackStateChanged(state: Int) {
                            if (state == Player.STATE_READY && ready == 0L) { ready = SystemClock.elapsedRealtime() - t0; bytesAtReady = total.get() }
                        }
                        override fun onPlayerError(error: androidx.media3.common.PlaybackException) { result.put("error", "${error.errorCodeName}: ${error.cause}") }
                    })
                    p.setMediaSource(DefaultMediaSourceFactory(factory).createMediaSource(MediaItem.fromUri(uri)), startMs)
                    p.prepare(); p.playWhenReady = true
                }
                for (second in 1..100) {
                    Thread.sleep(1000)
                    instrumentation.runOnMainSync {
                        val p = player!!
                        samples.put("${second}s state=${p.playbackState} pos=${p.currentPosition / 1000}s ahead=${p.totalBufferedDuration / 1000}s read=${total.get() / 1024}KB seekable=${p.isCurrentMediaItemSeekable} dur=${p.duration / 1000}s video=${p.videoFormat?.sampleMimeType}")
                    }
                    engine.stats(uri)?.let { st ->
                        st.fileBytes.takeIf { it > 0 }?.let { result.put("fileKB", it / 1024) }
                        st.mkvHead?.let { result.put("mkvHead", it) }
                        result.put("mkvSkippedKB", st.mkvSkipped / 1024)
                    }
                    if (ready > 0 && SystemClock.elapsedRealtime() - t0 > ready + 15_000) break
                }
            } finally {
                runCatching { instrumentation.runOnMainSync { player?.release() } }
                images.close(); consumer.quitSafely(); engine.release(uri); engine.close()
            }
            result.put("readyMs", ready).put("firstFrameMs", frame).put("bytesBeforeReadyKB", if (bytesAtReady >= 0) bytesAtReady / 1024 else -1)
                .put("opens", opens).put("samples", samples)
            File(context.filesDir, "addon-proof/reads-$startMs.json").apply { parentFile!!.mkdirs() }.writeText(result.toString(2))
            println("READS start=${startMs / 1000}s readyMs=$ready frameMs=$frame bytesBeforeReadyKB=${result.optLong("bytesBeforeReadyKB")} opens=${opens.length()} skippedKB=${result.optLong("mkvSkippedKB")} head=${result.optString("mkvHead")} error=${result.optString("error")} title=${choice.title.take(70)}")
            // حلقة المستخدم: لا خطأ استخراج ويصل READY (كانت تتوقف بـ «Out of range» في Media3 1.5.1)
            org.junit.Assert.assertEquals("player error at start=${startMs / 1000}s", "", result.optString("error"))
            org.junit.Assert.assertTrue("READY at start=${startMs / 1000}s", ready > 0)
        }
    }
}
