package eu.kanade.tachiyomi.animesource.online

import eu.kanade.tachiyomi.animesource.AnimeCatalogueSource
import eu.kanade.tachiyomi.animesource.model.AnimeFilterList
import eu.kanade.tachiyomi.animesource.model.AnimesPage
import eu.kanade.tachiyomi.animesource.model.Hoster
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.network.awaitSuccess
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import uy.kohesive.injekt.injectLazy
import java.net.URI
import java.net.URISyntaxException
import java.security.MessageDigest

/**
 * سطح المستضيف لإضافات الأنمي (Aniyomi/Komikku extensions-lib، Apache-2.0).
 *
 * التواقيع هنا **مطابقة حرفيًّا** لمكتبة komikku-app/aniyomi-extensions-lib
 * (f5961b5dfb) التي تُصرَّف عليها إضافات yuzono: أي اختلاف في اسم أو معامل
 * أو قيمة افتراضية يعني `NoSuchMethodError` عند أول نداء من الإضافة. والأجسام
 * منقولة من تنفيذ تطبيق Aniyomi نفسه.
 *
 * هذه الطبقة «مترجم» فقط: لا منطق لـVANTARA هنا. الدومينات والصحة والتبديل
 * تسكن في `com.vantara.anime` وتعمل على العميل الذي يُحقن في الإضافة.
 */
@Suppress("unused", "MemberVisibilityCanBePrivate")
abstract class AnimeHttpSource : AnimeCatalogueSource {

    protected val network: NetworkHelper by injectLazy()

    abstract val baseUrl: String

    open val versionId: Int = 1

    override val id: Long by lazy { generateId(name, lang, versionId) }

    val headers: Headers by lazy { headersBuilder().build() }

    open val client: OkHttpClient
        get() = network.client

    protected fun generateId(name: String, lang: String, versionId: Int): Long {
        val key = "${name.lowercase()}/$lang/$versionId"
        val bytes = MessageDigest.getInstance("MD5").digest(key.toByteArray())
        return (0..7).map { bytes[it].toLong() and 0xff shl 8 * (7 - it) }.reduce(Long::or) and Long.MAX_VALUE
    }

    protected open fun headersBuilder(): Headers.Builder = Headers.Builder().apply {
        add("User-Agent", network.defaultUserAgentProvider())
    }

    override fun toString(): String = "$name (${lang.uppercase()})"

    // ── الكتالوج ──

    override suspend fun getPopularAnime(page: Int): AnimesPage =
        client.newCall(popularAnimeRequest(page)).awaitSuccess().use { popularAnimeParse(it) }

    protected abstract fun popularAnimeRequest(page: Int): Request

    protected abstract fun popularAnimeParse(response: Response): AnimesPage

    override suspend fun getSearchAnime(page: Int, query: String, filters: AnimeFilterList): AnimesPage =
        client.newCall(searchAnimeRequest(page, query, filters)).awaitSuccess().use { searchAnimeParse(it) }

    protected abstract fun searchAnimeRequest(page: Int, query: String, filters: AnimeFilterList): Request

    protected abstract fun searchAnimeParse(response: Response): AnimesPage

    override suspend fun getLatestUpdates(page: Int): AnimesPage =
        client.newCall(latestUpdatesRequest(page)).awaitSuccess().use { latestUpdatesParse(it) }

    protected abstract fun latestUpdatesRequest(page: Int): Request

    protected abstract fun latestUpdatesParse(response: Response): AnimesPage

    // ── التفاصيل ──

    override suspend fun getAnimeDetails(anime: SAnime): SAnime =
        client.newCall(animeDetailsRequest(anime)).awaitSuccess().use { response ->
            animeDetailsParse(response).apply { initialized = true }
        }

    open fun animeDetailsRequest(anime: SAnime): Request = GET(baseUrl + anime.url, headers)

    protected abstract fun animeDetailsParse(response: Response): SAnime

    // KMK -->
    override val supportsRelatedAnimes: Boolean get() = true

    override suspend fun fetchRelatedAnimeList(anime: SAnime): List<SAnime> =
        client.newCall(relatedAnimeListRequest(anime)).awaitSuccess().use { relatedAnimeListParse(it) }

    protected open fun relatedAnimeListRequest(anime: SAnime): Request = animeDetailsRequest(anime)

    protected open fun relatedAnimeListParse(response: Response): List<SAnime> = popularAnimeParse(response).animes
    // KMK <--

    // ── الحلقات والمواسم ──

    override suspend fun getEpisodeList(anime: SAnime): List<SEpisode> =
        client.newCall(episodeListRequest(anime)).awaitSuccess().use { episodeListParse(it) }

    protected open fun episodeListRequest(anime: SAnime): Request = GET(baseUrl + anime.url, headers)

    protected abstract fun episodeListParse(response: Response): List<SEpisode>

    override suspend fun getSeasonList(anime: SAnime): List<SAnime> =
        client.newCall(seasonListRequest(anime)).awaitSuccess().use { seasonListParse(it) }

    protected open fun seasonListRequest(anime: SAnime): Request = GET(baseUrl + anime.url, headers)

    protected abstract fun seasonListParse(response: Response): List<SAnime>

    // ── السيرفرات والفيديو ──

    override suspend fun getHosterList(episode: SEpisode): List<Hoster> =
        client.newCall(hosterListRequest(episode)).awaitSuccess().use { hosterListParse(it) }

    protected open fun hosterListRequest(episode: SEpisode): Request = GET(baseUrl + episode.url, headers)

    protected abstract fun hosterListParse(response: Response): List<Hoster>

    override suspend fun getVideoList(hoster: Hoster): List<Video> =
        client.newCall(videoListRequest(hoster)).awaitSuccess().use { videoListParse(it, hoster) }

    protected open fun videoListRequest(hoster: Hoster): Request = GET(hoster.hosterUrl, headers)

    protected open fun videoListParse(response: Response, hoster: Hoster): List<Video> =
        throw UnsupportedOperationException("videoListParse")

    /** الفيديو الكسول (`initialized=false`) يُحل هنا قبل التشغيل مباشرة. */
    open suspend fun resolveVideo(video: Video): Video? = video

    open fun List<Hoster>.sortHosters(): List<Hoster> = this

    protected open fun List<Video>.sortVideos(): List<Video> = this

    @Deprecated("Use resolveVideo instead")
    open suspend fun getVideoUrl(video: Video): String =
        @Suppress("DEPRECATION")
        client.newCall(videoUrlRequest(video)).awaitSuccess().use { videoUrlParse(it) }

    @Deprecated("Use resolveVideo instead")
    protected open fun videoUrlRequest(video: Video): Request = GET(video.videoUrl, headers)

    @Deprecated("Use resolveVideo instead")
    protected open fun videoUrlParse(response: Response): String =
        throw UnsupportedOperationException("videoUrlParse")

    // ── أدوات الروابط ──

    fun SEpisode.setUrlWithoutDomain(url: String) {
        this.url = getUrlWithoutDomain(url)
    }

    fun SAnime.setUrlWithoutDomain(url: String) {
        this.url = getUrlWithoutDomain(url)
    }

    private fun getUrlWithoutDomain(orig: String): String = try {
        val uri = URI(orig.replace(" ", "%20"))
        var out = uri.path
        if (uri.query != null) out += "?" + uri.query
        if (uri.fragment != null) out += "#" + uri.fragment
        out
    } catch (_: URISyntaxException) {
        orig
    }

    open fun getAnimeUrl(anime: SAnime): String = animeDetailsRequest(anime).url.toString()

    open fun getEpisodeUrl(episode: SEpisode): String = episode.url

    open fun prepareNewEpisode(episode: SEpisode, anime: SAnime) {}

    override fun getFilterList(): AnimeFilterList = AnimeFilterList()
}
