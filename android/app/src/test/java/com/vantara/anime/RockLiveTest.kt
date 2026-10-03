package com.vantara.anime

import com.vantara.anime.adapters.*
import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.registry.ManifestParser
import com.vantara.anime.stream.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Opt-in actual Kotlin source/resolver HTTP tests. JVM/proxy evidence, never a phone or WebView claim. */
class RockLiveTest {
    @Test fun matrix() = runBlocking {
        assumeTrue(System.getenv("VANTARA_ROCK_LIVE") == "1")
        val ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"
        val jar = object : CookieJar {
            val cookies = mutableMapOf<String, Cookie>()
            override fun saveFromResponse(url: HttpUrl, received: List<Cookie>) = synchronized(cookies) { received.forEach { cookies[it.domain + it.name] = it } }
            override fun loadForRequest(url: HttpUrl) = synchronized(cookies) { cookies.values.filter { it.matches(url) } }
        }
        val builder = OkHttpClient.Builder().cookieJar(jar).fastFallback(true)
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).callTimeout(25, TimeUnit.SECONDS)
            .eventListenerFactory { com.vantara.anime.net.AnimeNetworkEvents() }
            .addInterceptor { it.proceed(it.request().newBuilder().header("User-Agent", ua).build()) }
        val proxyUrl = System.getenv("HTTPS_PROXY") ?: System.getenv("https_proxy")
        if (proxyUrl != null) URI(proxyUrl).let { builder.proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress(it.host, it.port))) }
        val client = builder.build()
        val embeds = EmbedResolver(client, userAgent = { ua }) // No browser fallback on JVM.
        val manifest = ManifestParser.parse(File("../../apps/web/anime/sources.json").readText())
        val results = mutableListOf<JsonObject>()
        fun get(url: String) = client.newCall(Request.Builder().url(url).build()).execute().use { it.body.string() }
        for (id in listOf("okanime", "arabseed", "ristoanime", "shahiid", "egydead", "akwam", "witanime")) {
            val e = manifest.sources.first { it.id == id }
            val base = e.domains.current
            val rows = ConcurrentHashMap<String, RouteReport>()
            val latency = ConcurrentHashMap<String, Long>()
            val probes = ConcurrentHashMap<String, JsonObject>()
            var searchCount = 0; var epCount = 0; var work = ""; var failure: String? = null
            var start = 0L
            val first = java.util.concurrent.atomic.AtomicLong(-1)
            val resolvedFirst = java.util.concurrent.atomic.AtomicLong(-1)
            val probeJobs = java.util.concurrent.CopyOnWriteArrayList<Job>()
            fun accept(r: RouteReport) {
                rows[r.key] = r
                if (r.state != RouteState.RESOLVING) latency.putIfAbsent(r.key, System.currentTimeMillis() - start)
                if (r.candidates.isNotEmpty()) resolvedFirst.compareAndSet(-1, System.currentTimeMillis() - start)
                for (c in r.candidates) if (probes.putIfAbsent(c.id, buildJsonObject { put("status", "PROBING") }) == null) {
                    probeJobs += launch(Dispatchers.IO) {
                        val t = System.currentTimeMillis()
                        val verdict = runCatching { StreamProbe.check(client, c) }
                        val ok = verdict.getOrDefault(false)
                        if (ok) first.compareAndSet(-1, System.currentTimeMillis() - start)
                        probes[c.id] = buildJsonObject {
                            put("host", c.host); put("resolver", c.server); put("quality", c.quality ?: 0)
                            put("status", if (ok) "MEDIA_VERIFIED" else "VERIFICATION_FAILED")
                            put("probeMs", System.currentTimeMillis() - t)
                            put("network", com.vantara.anime.net.AnimeNetworkEvents.of(c.host) ?: "unknown")
                            verdict.exceptionOrNull()?.let { put("reason", it.message) }
                        }
                    }
                }
            }
            try {
                withTimeout(100_000) {
                    if (id == "okanime") {
                        // Exercise maintained manifest page extraction + production EmbedResolver.
                        // Discovery is its real JSON API, not the Android-loaded Aniyomi extension.
                        val hits = Json.parseToJsonElement(get("$base/api/search?q=naruto")).jsonArray
                        searchCount = hits.size
                        val hit = hits.first().jsonObject; work = hit["name"]!!.jsonPrimitive.content
                        val html = get("$base/anime/${hit["slug"]!!.jsonPrimitive.content}")
                        val eps = e.episodes!!.extract(html, base); epCount = eps.size
                        val page = "$base${eps.first().path}"; val servers = e.embeds!!.extract(get(page), page)
                        start = System.currentTimeMillis()
                        coroutineScope {
                            servers.mapIndexed { i, server -> launch {
                                val key = "s$i"
                                accept(RouteReport(id, key, server.name, server.quality, Variant.SUB, RouteState.RESOLVING))
                                fun convert(list: List<com.vantara.anime.hosts.Stream>) = list.map { st -> Candidate("$key|${st.url.hashCode()}", id, e.name, server.name, StreamClassifier.host(st.url), st.url, st.headers, st.quality ?: server.quality, variant = Variant.SUB, container = StreamClassifier.container(st.url), resolvedAt = start, expiresAt = Long.MAX_VALUE) }
                                try {
                                    val cs = convert(embeds.resolve(server.url, page) { accept(RouteReport(id, key, server.name, server.quality, Variant.SUB, RouteState.READY, convert(it))) })
                                    accept(RouteReport(id, key, server.name, server.quality, Variant.SUB, if (cs.isEmpty()) RouteState.UNAVAILABLE else RouteState.READY, cs))
                                } catch (t: Exception) { accept(RouteReport(id, key, server.name, server.quality, Variant.SUB, RouteState.UNAVAILABLE, reason = t.message)) }
                            } }.joinAll()
                        }
                    } else {
                        val a: AnimeAdapter = when (id) {
                            "arabseed" -> ArabSeedSiteAdapter(id, e.name, client, { base }, embeds)
                            "ristoanime" -> RistoAnimeSiteAdapter(id, e.name, client, { base }, embeds)
                            "shahiid" -> ShahiidSiteAdapter(id, e.name, client, { base }, embeds)
                            "egydead" -> EgyDeadSiteAdapter(id, e.name, client, { base }, embeds)
                            "akwam" -> AkwamSiteAdapter(id, e.name, client, { base })
                            else -> WitAnimeSiteAdapter(id, e.name, client, { base }, embeds)
                        }
                        val hits = a.page(Listing.SEARCH, 1, "naruto").items; searchCount = hits.size
                        val item = hits.first(); work = item.title
                        val eps = a.episodes(item); epCount = eps.size
                        start = System.currentTimeMillis()
                        a.candidates(eps.first(), trace = ResolveTrace(::accept), enough = Int.MAX_VALUE)
                    }
                    probeJobs.joinAll()
                }
            } catch (t: Exception) { failure = "${t.javaClass.simpleName}: ${t.message}" }
            val row = buildJsonObject {
                put("source", id); put("platform", if (id == "okanime") "JVM page-rule/JSON API shadow; extension discovery untested" else "APK Kotlin adapters on JVM/proxy; no Android/WebView")
                put("search", searchCount); put("episodes", epCount); put("work", work)
                put("firstResolvedMs", resolvedFirst.get()); put("firstMediaVerifiedMs", first.get())
                put("allMs", if (start > 0) System.currentTimeMillis() - start else -1)
                failure?.let { put("failure", it) }
                put("routes", buildJsonArray { rows.entries.sortedBy { it.key }.forEach { (key, r) -> add(buildJsonObject {
                    put("server", r.server); put("state", r.state.name); put("ms", latency[key] ?: -1)
                    put("streams", r.candidates.size); put("reason", r.reason)
                    put("media", buildJsonArray { r.candidates.forEach { probes[it.id]?.let(::add) } })
                }) } })
            }
            results += row; println("ROCK $row")
        }
        File("build/reports/rock-live.json").apply { parentFile?.mkdirs(); writeText(JsonArray(results).toString()) }
        Unit
    }
}
