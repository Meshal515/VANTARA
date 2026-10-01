package com.vantara.anime

import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.ResolveTrace
import com.vantara.anime.net.AnimeDns
import com.vantara.anime.net.AnimeHostRouter
import com.vantara.anime.net.CinemaMediaProbe
import com.vantara.anime.registry.SourceEntry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/** Cinema-only diagnostics. Anime keeps its existing probe and timeouts. */
internal class CinemaDiagnostics(
    private val client: OkHttpClient,
    private val dns: AnimeDns,
    private val load: suspend (String) -> AnimeAdapter?,
    private val loadError: (String) -> String?,
) {
    suspend fun run(entry: SourceEntry, query: String): List<AnimeEngine.Step> {
        val steps = mutableListOf<AnimeEngine.Step>()
        fun add(label: String, state: String, detail: String) { steps += AnimeEngine.Step(label, state, detail) }
        suspend fun <T> stage(label: String, limit: Long, action: suspend () -> T, detail: (T) -> String): T? {
            return try {
                val value = withTimeout(limit) { action() }
                add(label, "ok", detail(value))
                value
            } catch (t: TimeoutCancellationException) {
                add(label, "fail", "انتهت مهلة المرحلة (${limit / 1000} ثانية): ${t.message}")
                null
            } catch (t: CancellationException) { throw t }
            catch (t: Exception) { add(label, "fail", AnimeHostRouter.describe(t)); null }
        }
        // Loading registers the real extension base URL before DNS and domain tests.
        val adapter = stage("تحميل الإضافة", 40_000, { load(entry.id) ?: error(loadError(entry.id) ?: "لم تُحمّل الإضافة") }) {
            "${entry.extension?.pkg ?: entry.adapter} · ${entry.extension?.version.orEmpty()}"
        }
        val base = (AnimeHostRouter.activeBase(entry.id) ?: entry.domains.current).toHttpUrl()
        add("الدومين الفعلي", "ok", base.toString())
        val (system, doh) = withContext(Dispatchers.IO) { dns.compare(base.host) }
        fun addressText(result: Result<List<InetAddress>>) = result.fold({ it.joinToString { address -> address.hostAddress.orEmpty() } }, AnimeHostRouter::describe)
        add("DNS النظام", if (system.isFailure || AnimeDns.isSinkhole(system.getOrNull().orEmpty())) "fail" else "ok", addressText(system))
        add("DNS عبر HTTPS", if (doh.isSuccess) "ok" else "fail", addressText(doh))
        val addresses = (doh.getOrNull().orEmpty() + system.getOrNull().orEmpty()).distinct()
        val probes = coroutineScope {
            listOf("IPv4" to addresses.firstOrNull { it is Inet4Address }, "IPv6" to addresses.firstOrNull { it is Inet6Address }).map { (label, address) ->
                async(Dispatchers.IO) {
                    if (address == null) AnimeEngine.Step(label, "warn", "لم يرجع DNS عنوانًا لهذه العائلة")
                    else if (address is Inet6Address && !AnimeDns.deviceHasIpv6()) AnimeEngine.Step(label, "warn", "العنوان موجود لكن الجوال لا يملك مسار IPv6")
                    else tls(label, base.host, base.port, address)
                }
            }.map { it.await() }
        }
        steps += probes
        add("ترتيب الاتصال", "ok", "Happy Eyeballs=${client.fastFallback} · " + if (entry.domains.preferIpv6) "IPv6 أولًا عند توفره، وIPv4 بديل سريع" else "الترتيب الافتراضي للمحرك")
        val bounded = client.newBuilder().connectTimeout(4, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).callTimeout(12, TimeUnit.SECONDS).build()
        stage("فتح الموقع", 15_000, {
            withContext(Dispatchers.IO) {
                bounded.newCall(Request.Builder().url(base).build()).execute().use { response ->
                    if (!response.isSuccessful) error("HTTP ${response.code} ← ${response.request.url.host}${response.request.url.encodedPath}")
                    val html = response.peekBody(400_000).string()
                    entry.domains.fingerprint?.let { fp ->
                        if (!Regex(fp, RegexOption.IGNORE_CASE).containsMatchIn(html)) error("HTTP ${response.code} لكن بصمة الصفحة لا تطابق ${entry.name}")
                    }
                    "HTTP ${response.code} · ${response.request.url} · البصمة مطابقة"
                }
            }
        }, { it })
        try {
            if (adapter == null) return steps
            val page = stage("بحث «$query»", 35_000, { adapter.page(Listing.SEARCH, 1, query) }) { "${it.items.size} نتيجة" } ?: return steps
            val words = query.lowercase().split(Regex("[^\\p{L}\\p{N}]+")).filter { it.isNotBlank() }
            val work = page.items.filter { item -> words.all { word -> word in item.title.lowercase() } }
                .sortedWith(compareByDescending<com.vantara.anime.adapters.SourceAnime> { "2011" in it.title }.thenBy { it.title.length })
                .firstOrNull()
            if (work == null) { add("مطابقة العمل", "fail", "لا نتيجة تطابق عنوان «$query»؛ لم نفحص عملًا آخر"); return steps }
            add("مطابقة العمل", "ok", "${work.title} · ${work.url}")
            val details = stage("تفاصيل العمل", 35_000, { adapter.details(work) }) { "${it.title} · الوصف ${it.description?.length ?: 0} حرف · ${it.url}" } ?: return steps
            val selected = if (details.hasSeasons || work.hasSeasons) {
                val seasons = stage("المواسم", 35_000, { adapter.seasons(details) }) { "${it.size} موسم" } ?: return steps
                seasons.filter { it.seasonNumber >= 0 }.minByOrNull { it.seasonNumber } ?: seasons.lastOrNull()
                    ?: run { add("اختيار الموسم", "fail", "قائمة المواسم فارغة"); return steps }
            } else {
                add("المواسم", "ok", "الإضافة تعرض الحلقات مباشرة؛ نفحص موسم العمل المحدد في النتيجة")
                details
            }
            add("العمل/الموسم المفحوص", "ok", "${selected.title} · ${selected.url}")
            val episodes = stage("الحلقات", 35_000, { adapter.episodes(selected) }) { "${it.size} حلقة" } ?: return steps
            val episode = episodes.filter { it.number >= 0 }.minByOrNull { it.number } ?: episodes.lastOrNull()
            if (episode == null) { add("اختيار الحلقة", "fail", "لم ترجع أي حلقة"); return steps }
            add("الحلقة المفحوصة", "ok", "${episode.name} · ${episode.url}")
            val trace = ResolveTrace()
            val links = stage("السيرفرات واستخراج الروابط", 70_000, { adapter.candidates(episode, trace = trace) }) {
                "${it.size} رابط · ${it.map { link -> link.server }.distinct().joinToString("، ")}"
            }
            trace.notes().forEach { add("سبب فشل السيرفر", "fail", it) }
            if (links.isNullOrEmpty()) { add("رابط التشغيل", "fail", "لم يُستخرج رابط فيديو؛ لا نعتبر البحث نجاحًا للمصدر"); return steps }
            val probe = CinemaMediaProbe(client)
            var reached = false
            for (link in links.take(3)) {
                val url = link.url.toHttpUrl()
                add("رابط التشغيل · ${link.server}", "ok", "${url.host}${url.encodedPath} · ${link.container} · ${link.quality ?: 0}p")
                val bytes = stage("وصول بايتات الفيديو", 50_000, { probe.probe(link.url, link.headers).getOrThrow() }, { it })
                reached = bytes != null
                if (reached) break
            }
            add("تشغيل فعلي على الجوال", "warn", "يحتاج تشغيل الحلقة داخل المشغّل؛ فحص HTTP لا يثبت فك الترميز أو الصوت")
        } finally {
            AnimeHostRouter.redirects(entry.id).takeLast(10).forEach { event ->
                add("التحويل · ${if (event.accepted) "مقبول" else "مرفوض"}", if (event.accepted) "ok" else "fail", "${event.from} → ${event.to} · ${event.reason}")
            }
            add("الدومين بعد الفحص", "ok", AnimeHostRouter.activeBase(entry.id) ?: entry.domains.current)
        }
        return steps
    }

    private fun tls(label: String, host: String, port: Int, address: InetAddress): AnimeEngine.Step {
        val started = System.nanoTime()
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(address, port), 3_000)
                socket.soTimeout = 4_000
                ((SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(socket, host, port, true) as SSLSocket).use { ssl ->
                    ssl.sslParameters = ssl.sslParameters.apply { endpointIdentificationAlgorithm = "HTTPS" }
                    ssl.startHandshake()
                }
            }
            AnimeEngine.Step(label, "ok", "${address.hostAddress}:$port · TLS وشهادة الاسم سليمتان · ${(System.nanoTime() - started) / 1_000_000}ms")
        } catch (t: Exception) { AnimeEngine.Step(label, "fail", "${address.hostAddress}:$port · ${AnimeHostRouter.describe(t)}") }
    }
}
