package com.vantara.anime.adapters

import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.stream.*
import eu.kanade.tachiyomi.network.GET
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/** Current native Cinema source pages; each selected season stays at its own URL. */
abstract class CinemaSiteAdapter(
    override val id: String,
    override val name: String,
    protected val client: OkHttpClient,
    protected val base: () -> String,
    private val embeds: EmbedResolver,
) : AnimeAdapter {
    protected fun abs(path: String) = if (path.startsWith("http")) path else base().trimEnd('/') + "/" + path.trimStart('/')
    protected suspend fun html(path: String): Pair<String, String> = client.newCall(GET(abs(path))).awaitOk().use { it.request.url.toString() to it.body.string() }
    protected abstract suspend fun serverLinks(episode: SourceEpisode): Pair<String, List<String>>
    override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int): List<Candidate> = resolve(episode, now, trace, enough, null)
    override suspend fun preferredCandidates(episode: SourceEpisode, server: String, now: Long, trace: ResolveTrace?): List<Candidate> = resolve(episode, now, trace, Int.MAX_VALUE, server)
    private suspend fun resolve(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int, preferred: String?): List<Candidate> {
        val (referer, links) = serverLinks(episode)
        if (links.isEmpty()) trace?.note("المصدر", "لا سيرفرات متاحة لهذا العمل")
        val servers = links.flatMap { link ->
            try { withTimeoutOrNull(20_000) { embeds.expandCinema(link, referer) }.orEmpty() }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { trace?.note("السيرفرات", e.brief()); emptyList() }
        }
        val ordered = servers.sortedByDescending { it.server.equals(preferred, true) }
        return gatherUntil(ordered.map { server -> suspend {
            val link = server.url
            val host = server.server
            val key = "c" + Integer.toHexString(link.hashCode())
            fun report(state: RouteState, candidates: List<Candidate> = emptyList(), reason: String? = null) = trace?.route(RouteReport(id, key, host, candidates.maxOfOrNull { it.quality ?: 0 }?.takeIf { it > 0 } ?: server.quality, Variant.SUB, state, candidates, reason))
            report(RouteState.RESOLVING)
            var reason: String? = null
            val list = withTimeoutOrNull(45_000) {
                try {
                    embeds.resolve(link, server.referer).map { stream ->
                        Candidate(id = "$id|${episode.url}|${stream.url.hashCode()}", sourceId = id, sourceName = name,
                            server = host, host = StreamClassifier.host(stream.url), url = stream.url, headers = stream.headers,
                            quality = stream.quality ?: server.quality, label = stream.label.ifBlank { host }, variant = Variant.SUB,
                            container = stream.container ?: StreamClassifier.container(stream.url), resolvedAt = now,
                            expiresAt = StreamClassifier.expiresAt(stream.url, now))
                    }
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { reason = e.brief(); emptyList() }
            }
            when {
                list == null -> emptyList<Candidate>().also { report(RouteState.UNAVAILABLE, reason = "لم يرد السيرفر خلال 45 ثانية") }
                list.isEmpty() -> list.also { report(RouteState.UNAVAILABLE, reason = reason ?: "لم يُستخرج رابط فيديو") }
                else -> list.also { report(RouteState.READY, it) }
            }
        } }, enough)
    }
}

class TuktukSiteAdapter(id: String, name: String, client: OkHttpClient, base: () -> String, embeds: EmbedResolver) : CinemaSiteAdapter(id, name, client, base, embeds) {
    override suspend fun page(listing: Listing, page: Int, query: String): SourcePage {
        require(page > 0) { "رقم صفحة غير صالح" }
        val path = when (listing) {
            Listing.POPULAR -> if (page == 1) "/main/" else "/main/page/$page/"
            Listing.LATEST -> if (page == 1) "/recent/" else "/recent/page/$page/"
            Listing.SERIES -> "/channel/full-series-1/?page=$page"
            Listing.SEARCH -> abs("/").toHttpUrl().newBuilder().addQueryParameter("s", query.trim()).addQueryParameter("page", page.toString()).build().toString()
        }
        val (url, body) = html(path)
        val cards = TuktukParser.cards(body, url, id)
        return SourcePage(if (listing == Listing.POPULAR) cards.filter { it.mediaType == "movie" } else cards, TuktukParser.hasNext(body, url))
    }
    override suspend fun details(anime: SourceAnime): SourceAnime {
        var (url, body) = html(anime.url)
        var copy = anime
        if (anime.mediaType == "series" && anime.seasonNumber <= 0) {
            val root = TuktukParser.seriesRoot(body, url)
            if (root != null && root != sourcePath(url)) {
                copy = anime.copy(url = root)
                val response = html(root); url = response.first; body = response.second
            }
        }
        return TuktukParser.details(body, url, copy)
    }
    override suspend fun seasons(anime: SourceAnime): List<SourceAnime> {
        if (anime.mediaType == "movie") return emptyList()
        val (url, body) = html(anime.url)
        return TuktukParser.seasons(body, url, anime)
    }
    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
        if (anime.mediaType == "movie") return TuktukParser.episodes("", abs(anime.url), anime)
        val (url, body) = html(anime.url)
        return TuktukParser.episodes(body, url, anime)
    }
    override suspend fun serverLinks(episode: SourceEpisode): Pair<String, List<String>> {
        val (url, body) = html(episode.url)
        return url to TuktukParser.embeds(body, url)
    }
    companion object { const val KIND = "tuktuk-site" }
}

class EgyDeadSiteAdapter(id: String, name: String, client: OkHttpClient, base: () -> String, embeds: EmbedResolver) : CinemaSiteAdapter(id, name, client, base, embeds) {
    override suspend fun page(listing: Listing, page: Int, query: String): SourcePage {
        require(page > 0)
        val path = when (listing) {
            Listing.SEARCH -> abs("/page/$page/").toHttpUrl().newBuilder().addQueryParameter("s", query.trim()).build().toString()
            Listing.SERIES -> "/serie/?page=$page"
            Listing.POPULAR, Listing.LATEST -> "/?page=$page"
        }
        val (url, body) = html(path)
        val cards = EgyDeadParser.cards(body, url, id)
        val doc = org.jsoup.Jsoup.parse(body, url)
        return SourcePage(if (listing == Listing.POPULAR) cards.filter { it.mediaType == "movie" } else cards,
            doc.select("div.pagination a.next, div.pagination-two a").any { it.hasClass("next") || it.text().trim() in setOf("›", "»") })
    }
    override suspend fun details(anime: SourceAnime): SourceAnime {
        var (url, body) = html(anime.url)
        var copy = anime
        if (anime.mediaType == "series" && anime.seasonNumber <= 0) {
            val root = EgyDeadParser.seriesRoot(body, url)
            if (root != null && root != sourcePath(url)) { copy = anime.copy(url = root); val response = html(root); url = response.first; body = response.second }
        }
        return EgyDeadParser.details(body, url, copy)
    }
    override suspend fun seasons(anime: SourceAnime): List<SourceAnime> {
        if (anime.mediaType == "movie") return emptyList()
        val (url, body) = html(anime.url); return EgyDeadParser.seasons(body, url, anime)
    }
    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
        if (anime.mediaType == "movie") return EgyDeadParser.episodes("", abs(anime.url), anime)
        val (url, body) = html(anime.url); return EgyDeadParser.episodes(body, url, anime)
    }
    override suspend fun serverLinks(episode: SourceEpisode): Pair<String, List<String>> {
        val req = Request.Builder().url(abs(episode.url)).post(FormBody.Builder().add("View", "1").build()).header("Referer", abs(episode.url)).build()
        return client.newCall(req).awaitOk().use { it.request.url.toString() to EgyDeadParser.embeds(it.body.string(), it.request.url.toString()) }
    }
    companion object { const val KIND = "egydead-site" }
}
