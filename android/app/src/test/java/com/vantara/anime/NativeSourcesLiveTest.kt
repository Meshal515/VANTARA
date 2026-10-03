package com.vantara.anime

import com.vantara.anime.adapters.AkwamSiteAdapter
import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.adapters.ArabSeedSiteAdapter
import com.vantara.anime.adapters.EgyDeadSiteAdapter
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.RistoAnimeSiteAdapter
import com.vantara.anime.adapters.ShahiidSiteAdapter
import com.vantara.anime.adapters.TukTukSiteAdapter
import com.vantara.anime.adapters.WitAnimeSiteAdapter
import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.stream.Candidate
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * مصفوفة حيّة لمحوّلات الـAPK الأصلية: نفس كود Kotlin الذي يشغّله التطبيق
 * (بحث ← حلقات ← كل السيرفرات ← أول بايتات الملف/قائمة HLS)، على المواقع
 * الحقيقية من JVM. الفرق الوحيد عن الجهاز: لا متصفح مخفي (WebView) لما لا
 * يُستخرج مباشرة، فما يحتاجه يظهر هنا «بلا رابط» وقد يعمل على الجهاز.
 *
 *   VANTARA_LIVE=1 ./gradlew :app:testDebugUnitTest --tests 'com.vantara.anime.NativeSourcesLiveTest'
 *   (VANTARA_LIVE_ONLY=akwam,arabseed لتقييد المصادر)
 *
 * الجدول في build/reports/native-sources-live.md. لا يُشغَّل في الاختبارات العادية.
 */
class NativeSourcesLiveTest {

    private val ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"
    /** جلسة كوكيز في الذاكرة كما في `NetworkHelper` (WitAnime يرفض POST بلا جلسته: 419). */
    private val jar = object : CookieJar {
        private val store = mutableMapOf<String, MutableMap<String, Cookie>>()
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) = synchronized(store) {
            cookies.forEach { store.getOrPut(it.domain) { mutableMapOf() }[it.name] = it }
        }
        override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(store) { store.values.flatMap { it.values }.filter { it.matches(url) } }
    }
    private val client = OkHttpClient.Builder()
        .cookieJar(jar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("User-Agent", ua).build()) }
        .build()
    private val embeds = EmbedResolver(client, sniffer = null, userAgent = { ua })

    private data class Case(val source: String, val query: String, val episode: Float? = null)

    private val cases = listOf(
        Case("akwam", "dune"), Case("akwam", "toy story"), Case("akwam", "shameless", 3f), Case("akwam", "breaking bad", 1f), Case("akwam", "the gentlemen"),
        Case("arabseed", "dune"), Case("arabseed", "toy story"), Case("arabseed", "shameless", 3f), Case("arabseed", "the gentlemen"),
        Case("egydead", "dune part 1"), Case("egydead", "toy story"), Case("egydead", "shameless", 3f), Case("egydead", "the gentlemen"),
        Case("tuktukcinema", "dune"), Case("tuktukcinema", "the gentlemen"), Case("tuktukcinema", "shameless", 3f),
        Case("witanime", "naruto", 1f), Case("witanime", "one piece", 1f), Case("witanime", "solo leveling", 1f),
        Case("ristoanime", "frieren", 1f), Case("ristoanime", "solo leveling", 1f), Case("ristoanime", "one piece", 1f), Case("ristoanime", "jujutsu", 1f),
        Case("shahiid", "naruto", 1f), Case("shahiid", "one piece", 1f), Case("shahiid", "solo leveling", 1f),
    )

    private fun adapter(id: String): AnimeAdapter = when (id) {
        "akwam" -> AkwamSiteAdapter(id, "Akwam", client, { "https://akwam.ss" })
        "arabseed" -> ArabSeedSiteAdapter(id, "ArabSeed", client, { "https://m.myseed.pics" }, embeds)
        "egydead" -> EgyDeadSiteAdapter(id, "EgyDead", client, { "https://tv10.egydead.live" }, embeds)
        "tuktukcinema" -> TukTukSiteAdapter(id, "TukTuk", client, { "https://tuktukhd.com" }, embeds)
        "witanime" -> WitAnimeSiteAdapter(id, "WitAnime", client, { "https://witanime.site" }, embeds)
        "ristoanime" -> RistoAnimeSiteAdapter(id, "RistoAnime", client, { "https://ristoanime.me" }, embeds)
        "shahiid" -> ShahiidSiteAdapter(id, "Shahiid", client, { "https://shahiid-anime.net" }, embeds)
        else -> error(id)
    }

    /** أول بايتات الرابط بترويساته: ملف فيديو حقيقي أو قائمة HLS. */
    private fun probe(c: Candidate): String = runCatching {
        val req = Request.Builder().url(c.url).apply { c.headers.forEach { (k, v) -> header(k, v) } }.header("Range", "bytes=0-2047").build()
        client.newCall(req).execute().use { r ->
            val head = r.body.byteStream().readNBytes(2048)
            val text = String(head, Charsets.ISO_8859_1)
            when {
                text.startsWith("#EXTM3U") -> "HLS ${r.code}"
                r.code in listOf(200, 206) && (text.contains("ftyp") || head.firstOrNull() == 0x1a.toByte() || r.header("Content-Type").orEmpty().startsWith("video")) -> "MP4 ${r.code}"
                else -> "✗ ${r.code} ${r.header("Content-Type").orEmpty()}"
            }
        }
    }.getOrElse { "✗ ${it.javaClass.simpleName}" }

    @Test fun matrix() = runBlocking {
        assumeTrue(System.getenv("VANTARA_LIVE") != null)
        val only = System.getenv("VANTARA_LIVE_ONLY")?.split(',')?.map { it.trim() }
        val rows = mutableListOf("| المصدر | العمل | بحث | الحلقات | السيرفرات | يعمل | الجودات | أول رابط | الزمن |", "|---|---|---|---|---|---|---|---|---|")
        var played = 0
        var total = 0
        for (case in cases.filter { only == null || it.source in only }) {
            total++
            val a = adapter(case.source)
            val t0 = System.currentTimeMillis()
            val row = runCatching {
                withTimeoutOrNull(120_000) {
                    val items = a.page(Listing.SEARCH, 1, case.query).items
                    val words = case.query.lowercase().split(' ')
                    val item = items.firstOrNull { i -> words.all { i.title.lowercase().contains(it) } } ?: items.firstOrNull()
                        ?: return@withTimeoutOrNull listOf("0", "-", "-", "-", "-", "لا نتيجة")
                    val eps = a.episodes(item)
                    val ep = (case.episode?.let { n -> eps.firstOrNull { it.number == n } } ?: eps.firstOrNull())
                        ?: return@withTimeoutOrNull listOf("${items.size} «${item.title.take(40)}»", "0", "-", "-", "-", "بلا حلقات")
                    val cands = a.candidates(ep)
                    val probes = cands.take(6).map { it to probe(it) }
                    val ok = probes.filter { !it.second.startsWith("✗") }
                    if (ok.isNotEmpty()) played++
                    listOf(
                        "${items.size} «${item.title.take(40)}»",
                        "${eps.size}",
                        "${cands.size} (${cands.map { it.host }.distinct().joinToString("، ")})",
                        "${ok.size}/${probes.size}",
                        ok.mapNotNull { it.first.quality }.distinct().sortedDescending().joinToString("/").ifBlank { "-" },
                        probes.firstOrNull()?.second ?: "بلا رابط",
                    )
                } ?: listOf("مهلة 120 ثانية", "", "", "", "", "")
            }.getOrElse { listOf("✗ ${it.javaClass.simpleName}: ${it.message?.take(60)}", "", "", "", "", "") }
            val line = "| ${case.source} | ${case.query}${case.episode?.let { " ح${it.toInt()}" } ?: ""} | ${row.joinToString(" | ")} | ${System.currentTimeMillis() - t0}ms |"
            println(line)
            rows += line
        }
        rows += ""
        rows += "شُغّل فعليًا (أول بايتات فيديو حقيقية): $played/$total"
        File("build/reports").mkdirs()
        File("build/reports/native-sources-live.md").writeText(rows.joinToString("\n") + "\n")
        println(rows.joinToString("\n"))
    }
}
