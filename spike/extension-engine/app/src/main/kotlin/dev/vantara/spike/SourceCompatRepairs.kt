package dev.vantara.spike

import eu.kanade.tachiyomi.network.awaitSuccess
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.model.Page
import eu.kanade.tachiyomi.source.model.SChapter
import eu.kanade.tachiyomi.source.model.SManga
import eu.kanade.tachiyomi.source.online.HttpSource
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import java.net.URI
import java.util.Base64

internal object SourceCompatRepairs {

    suspend fun loadChapters(source: CatalogueSource, manga: SManga): List<SChapter> {
        if (source.name == "Hizo Manga" && source is HttpSource) {
            return loadHizo(source, manga).chapters
        }
        return source.getMangaUpdate(
            manga = manga,
            chapters = emptyList(),
            fetchDetails = false,
            fetchChapters = true,
        ).chapters
    }

    suspend fun loadDetails(
        source: CatalogueSource,
        manga: SManga,
        knownChapters: List<SChapter>,
    ): SManga {
        if (source.name == "Hizo Manga" && source is HttpSource) {
            return loadHizo(source, manga).manga
        }
        return source.getMangaUpdate(
            manga = manga,
            chapters = knownChapters,
            fetchDetails = true,
            fetchChapters = false,
        ).manga
    }

    suspend fun loadPages(source: CatalogueSource, chapter: SChapter): List<Page> {
        if (source.name == "Dilar" && source is HttpSource) {
            return loadDilarPages(source, chapter)
        }

        val original = source.getPageList(chapter)
        if (
            source.name == "MangaDar" &&
            source is HttpSource &&
            original.any { !isHttpImage(it.imageUrl) }
        ) {
            return loadMangaDarPages(source, chapter)
        }
        return original
    }

    private suspend fun loadDilarPages(source: HttpSource, chapter: SChapter): List<Page> {
        val releaseId = chapter.url.substringAfterLast("#")
        require(releaseId != chapter.url && releaseId.isNotBlank()) {
            "Dilar chapter url has no release id: ${chapter.url}"
        }

        val clientKeys = DilarCryptoCompat.generateClientKeyPair()
        val cryptoHeaders = source.headers.newBuilder()
            .set("X-DH-Pub", DilarCryptoCompat.base64Url(DilarCryptoCompat.publicRaw(clientKeys.public)))
            .set("X-Crypto-Caps", "1,2,3,4,5,6,7,8,9,10,11,12")
            .build()
        val endpoint = "${source.baseUrl}/api/chapters/$releaseId"

        val unlockBody = "{}".toRequestBody("application/json".toMediaType())
        val unlockRequest = Request.Builder()
            .url("$endpoint/unlock/free")
            .headers(cryptoHeaders)
            .post(unlockBody)
            .build()
        val token = source.client.newCall(unlockRequest).awaitSuccess().use { response ->
            JSONObject(response.body.string()).getString("token")
        }

        val chapterRequest = Request.Builder()
            .url(endpoint)
            .headers(
                cryptoHeaders.newBuilder()
                    .set("X-Unlock-Free-Chapter", token)
                    .build(),
            )
            .get()
            .build()
        val encryptedJson = source.client.newCall(chapterRequest).awaitSuccess().use { response ->
            JSONObject(response.body.string())
        }

        val envelope = DilarEnvelope(
            version = encryptedJson.getInt("v"),
            epoch = encryptedJson.getLong("e"),
            ephemeralPublicKey = DilarCryptoCompat.decodeBase64Url(encryptedJson.getString("epk")),
            iv = DilarCryptoCompat.decodeBase64Url(encryptedJson.getString("iv")),
            ciphertext = DilarCryptoCompat.decodeBase64Url(encryptedJson.getString("ct")),
            tag = DilarCryptoCompat.decodeBase64Url(encryptedJson.getString("tag")),
        )
        val decrypted = JSONObject(
            DilarCryptoCompat.decrypt(envelope, clientKeys).toString(Charsets.UTF_8),
        )
        val storageKey = decrypted.getString("storage_key")
        val rawPages = decrypted.getJSONArray("pages")
        val pages = buildList {
            for (i in 0 until rawPages.length()) {
                val item = rawPages.getJSONObject(i)
                add(
                    item.getInt("order") to item.getString("url"),
                )
            }
        }.sortedBy { it.first }

        return pages.mapIndexed { index, (_, image) ->
            Page(
                index = index,
                imageUrl = "${source.baseUrl}/uploads/releases/$storageKey/hq/$image",
            )
        }
    }

    private suspend fun loadMangaDarPages(source: HttpSource, chapter: SChapter): List<Page> {
        val request = Request.Builder()
            .url(source.getChapterUrl(chapter))
            .headers(source.headers)
            .get()
            .build()
        val document = source.client.newCall(request).awaitSuccess().use { response ->
            Jsoup.parse(response.body.string(), response.request.url.toString())
        }

        return document.select(".reader-page img").mapIndexedNotNull { index, image ->
            val resolved = chooseRealImageUrl(
                listOf(
                    image.attr("abs:data-src"),
                    image.attr("abs:data-lazy-src"),
                    image.attr("abs:data-original"),
                    image.attr("abs:data-cfsrc"),
                    image.attr("abs:data-manga-src"),
                    firstSrcsetUrl(image.attr("abs:data-srcset")),
                    firstSrcsetUrl(image.attr("abs:srcset")),
                    image.attr("data-mds"),
                    image.attr("abs:src"),
                ),
            ) ?: return@mapIndexedNotNull null
            Page(index, imageUrl = resolved)
        }.also {
            require(it.isNotEmpty()) { "MangaDar page repair found no real image urls" }
        }
    }

    private data class HizoPayload(
        val manga: SManga,
        val chapters: List<SChapter>,
    )

    private suspend fun loadHizo(source: HttpSource, original: SManga): HizoPayload {
        val document = resolveHizoDocument(source, original)
        val canonical = document.selectFirst("meta[property=og:url]")?.attr("content")
            ?.takeIf(String::isNotBlank)
            ?: document.location()
        val canonicalPath = URI(canonical).path.ensureTrailingSlash()

        val manga = SManga.create().apply {
            url = original.url
            title = document.selectFirst("meta[property=og:title]")?.attr("content")
                ?.substringBefore(" - Hizo Manga")
                ?.takeIf(String::isNotBlank)
                ?: document.selectFirst("h1, h2")?.text()?.takeIf(String::isNotBlank)
                ?: runCatching { original.title }.getOrDefault("Hizo Manga")
            description = document.selectFirst("meta[property=og:description]")?.attr("content")
                ?.takeIf(String::isNotBlank)
            thumbnail_url = document.selectFirst("meta[property=og:image]")?.attr("content")
                ?.takeIf(String::isNotBlank)
            status = SManga.UNKNOWN
            initialized = true
        }

        val chapters = document.select("li.wp-manga-chapter a").mapNotNull { link ->
            val href = link.attr("abs:href").takeIf(String::isNotBlank) ?: return@mapNotNull null
            val slug = URI(href).path.trimEnd('/').substringAfterLast('/').takeIf(String::isNotBlank)
                ?: return@mapNotNull null
            SChapter.create().apply {
                url = slug
                name = link.text().ifBlank { slug }
                memo = buildJsonObject { put("mangaPath", canonicalPath) }
            }
        }.distinctBy { it.url }

        require(chapters.isNotEmpty()) {
            "Hizo canonical page has no chapters: $canonical"
        }
        return HizoPayload(manga, chapters)
    }

    private suspend fun resolveHizoDocument(source: HttpSource, manga: SManga): Document {
        val initialUrl = runCatching { source.getMangaUrl(manga) }
            .getOrElse { source.baseUrl + manga.url }
        val first = requestDocumentAllowError(source, initialUrl)
        val canonical = first.selectFirst("meta[property=og:url]")?.attr("content")
            ?.takeIf { "/content/" in it }
        if (canonical != null && canonical != first.location()) {
            return requestDocumentAllowError(source, canonical)
        }
        return first
    }

    private suspend fun requestDocumentAllowError(source: HttpSource, url: String): Document {
        val request = Request.Builder().url(url).headers(source.headers).get().build()
        return source.client.newCall(request).execute().use { response ->
            Jsoup.parse(response.body.string(), response.request.url.toString())
        }
    }
}

internal fun chooseRealImageUrl(candidates: List<String?>): String? =
    candidates.asSequence()
        .mapNotNull { it?.trim()?.takeIf(String::isNotBlank) }
        .map { candidate ->
            candidate.substringBefore(' ').trim().let { value ->
                if (isHttpImage(value)) {
                    value
                } else {
                    runCatching {
                        Base64.getDecoder().decode(value).toString(Charsets.UTF_8).trim()
                    }.getOrDefault(value)
                }
            }
        }
        .firstOrNull { isHttpImage(it) }

private fun firstSrcsetUrl(value: String?): String? =
    value?.split(',')?.firstOrNull()?.trim()?.substringBefore(' ')

private fun isHttpImage(url: String?): Boolean =
    url?.let {
        it.startsWith("https://", ignoreCase = true) ||
            it.startsWith("http://", ignoreCase = true)
    } == true

private fun String.ensureTrailingSlash(): String =
    if (endsWith('/')) this else "$this/"
