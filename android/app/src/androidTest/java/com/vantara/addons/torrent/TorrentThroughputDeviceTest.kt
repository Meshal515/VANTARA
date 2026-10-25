package com.vantara.addons.torrent

import android.os.SystemClock
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
        val variants = listOf(
            "production" to variant(null, false),
            "queue3" to variant(3, false),
            "tcp" to variant(null, true),
            "queue3+tcp" to variant(3, true),
        )
        for ((i, choice) in choices.withIndex()) {
            // الترتيب يتناوب حتى لا يستفيد بديل واحد من سرب «دافئ»
            val order = variants.indices.map { variants[(it + i) % variants.size] }
            for ((name, settings) in order) {
                val engine = TorrentEngine(context, sessionSettings = settings)
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
}
