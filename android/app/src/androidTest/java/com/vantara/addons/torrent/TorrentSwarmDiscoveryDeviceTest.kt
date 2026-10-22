package com.vantara.addons.torrent

import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.frostwire.jlibtorrent.SettingsPack
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * تشخيص: لماذا يتصل الـAPK بثلاثة إلى ستة مشاركين من سرب فيه آلاف الزارعين؟
 * على خيارات Torrentio حقيقية (الأعلى زارعين)، يسجّل كل ثانية: المتصلون، والمعروفون (listPeers)،
 * والمرشحون للاتصال، وعقد DHT، وأول إطار — بإعدادات الإنتاج مقابل إعدادات libtorrent الافتراضية.
 * المعروفون قليل = البحث عن المشاركين هو العيب؛ معروفون كثير ومتصلون قليل = الاتصال هو العيب.
 * Opt-in (-e swarmDiscovery 1) لأنه يعتمد على الإنترنت.
 */
@RunWith(AndroidJUnit4::class)
class TorrentSwarmDiscoveryDeviceTest {
    private data class Choice(val label: String, val hash: String, val fileIdx: Int?, val sources: List<String>, val title: String)

    private fun torrentio(path: String): List<Choice> {
        val c = URL("https://torrentio.strem.fun/stream/$path.json").openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", "Mozilla/5.0"); c.connectTimeout = 15000; c.readTimeout = 15000
        val streams = JSONObject(c.inputStream.bufferedReader().readText()).optJSONArray("streams") ?: JSONArray()
        return (0 until streams.length()).map { streams.getJSONObject(it) }.filter { it.has("infoHash") }
            .sortedByDescending { TorrentPrefetch.seeders(it.optString("title")) ?: 0 }.take(1).map { s ->
                val sources = s.optJSONArray("sources")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()
                Choice(path, s.getString("infoHash"), if (s.has("fileIdx")) s.getInt("fileIdx") else null, sources, s.optString("title").lineSequence().first().take(80))
            }
    }

    @Test fun swarmDiscoveryProductionVersusDefaults() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("opt-in", args.getString("swarmDiscovery") == "1")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val out = File(context.filesDir, "addon-proof/swarm-discovery.json").apply { parentFile!!.mkdirs() }
        val results = JSONArray()
        val choices = listOf("movie/tt0111161", "movie/tt0468569", "series/tt0903747:1:1", "series/kitsu:46474:1").flatMap { runCatching { torrentio(it) }.getOrDefault(emptyList()) }
        // «aggressive»: الإنتاج مع حدود اتصال أعلى ومهل اتصال أطول (شبكات الجوال بطيئة المصافحة) وبلا حد رفع
        // (رسائل طلب القطع وعبء IP تُحسب على الرفع؛ حد 128KB/s قد يبطئ التنزيل نفسه).
        val aggressive = {
            TorrentEngine.streamingSettings().connectionsLimit(400).uploadRateLimit(0).apply {
                setInteger(com.frostwire.jlibtorrent.swig.settings_pack.int_types.connection_speed.swigValue(), 200)
                setInteger(com.frostwire.jlibtorrent.swig.settings_pack.int_types.peer_connect_timeout.swigValue(), 15)
                setInteger(com.frostwire.jlibtorrent.swig.settings_pack.int_types.handshake_timeout.swigValue(), 15)
                setInteger(com.frostwire.jlibtorrent.swig.settings_pack.int_types.torrent_connect_boost.swigValue(), 100)
            }
        }
        val variants = listOf<Pair<String, () -> SettingsPack>>("production" to { TorrentEngine.streamingSettings() }, "aggressive" to aggressive)
        for ((i, choice) in choices.withIndex()) {
            val order = if (i % 2 == 0) variants else variants.reversed()
            for ((name, settings) in order) {
                val engine = TorrentEngine(context, sessionSettings = settings)
                try { results.put(attempt(engine, choice).put("variant", name)) } finally { engine.close() }
                out.writeText(JSONObject().put("results", results).toString(2))
                Thread.sleep(3000)
            }
        }
        out.writeText(JSONObject().put("results", results).toString(2))
    }

    private fun attempt(engine: TorrentEngine, choice: Choice): JSONObject {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        File(context.cacheDir, "torrent-streams").deleteRecursively()
        val uri = engine.register(TorrentRequest(choice.hash, choice.fileIdx, choice.sources))
        val result = JSONObject().put("label", choice.label).put("title", choice.title).put("trackers", choice.sources.count { it.startsWith("tracker:") })
        val timeline = JSONArray()
        val begun = SystemClock.elapsedRealtime()
        var firstFrameMs = -1L
        val consumer = HandlerThread("SwarmFrames").apply { start() }
        val images = ImageReader.newInstance(320, 180, ImageFormat.PRIVATE, 3)
        images.setOnImageAvailableListener({ r -> r.acquireLatestImage()?.close() }, Handler(consumer.looper))
        var player: ExoPlayer? = null
        try {
            instrumentation.runOnMainSync {
                val p = ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(engine.dataSourceFactory(DefaultDataSource.Factory(context)))).build()
                player = p; p.setVideoSurface(images.surface)
                p.addListener(object : Player.Listener { override fun onRenderedFirstFrame() { if (firstFrameMs < 0) firstFrameMs = SystemClock.elapsedRealtime() - begun } })
                p.setMediaItem(MediaItem.fromUri(uri)); p.prepare(); p.play()
            }
            for (second in 1..40) {
                Thread.sleep(1000)
                val s = engine.stats(uri)
                timeline.put("${second}s dht=${engine.dhtNodes()} peers=${s?.peers} seeds=${s?.seeds} known=${s?.known} cand=${s?.candidates} rate=${(s?.downloadBytesPerSecond ?: 0) / 1024}KB meta=${s?.metadata}")
            }
        } catch (error: Throwable) {
            result.put("failure", error.toString())
        } finally {
            runCatching { instrumentation.runOnMainSync { player?.release() } }
            images.close(); consumer.quitSafely(); engine.release(uri)
        }
        return result.put("firstFrameMs", firstFrameMs).put("timeline", timeline)
    }
}
