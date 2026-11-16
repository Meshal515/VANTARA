package com.lagradost.cloudstream3.network

import com.lagradost.cloudstream3.mapper
import dev.vantara.runtime.cloudstream.WorkerState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.runInterruptible
import okhttp3.Headers
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response

/**
 * CloudStream's hidden browser, with its signatures and defaults (library 4.9.1): a provider hands a page and a
 * pattern, the browser loads the page as a phone would and returns the first request whose URL matches (usually the
 * m3u8 a player builds in JavaScript), plus every request matching [additionalUrls].
 *
 * This worker is isolated and has no WebView. The page is opened by VANTARA's hidden browser in the host (the same one
 * its own sources use), through [WorkerState.browse]; only the requests it saw come back, never cookies or page
 * content. Without a host browser the result is "nothing intercepted", as on CloudStream's JVM build.
 */
class WebViewResolver(
    val interceptUrl: Regex,
    val additionalUrls: List<Regex> = emptyList(),
    val userAgent: String? = DEFAULT_USER_AGENT,
    val useOkhttp: Boolean = true,
    val script: String? = null,
    val scriptCallback: ((String) -> Unit)? = null,
    val timeout: Long = DEFAULT_TIMEOUT,
) : Interceptor {
    companion object {
        // Inlined by the compiler in providers (MainAPI's USER_AGENT); the same value the library ships.
        private const val DEFAULT_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
        val DEFAULT_TIMEOUT = 60_000L
        var webViewUserAgent: String? = null
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val fixed = runBlocking { resolveUsingWebView(request).first }
        return chain.proceed(fixed ?: request)
    }

    suspend fun resolveUsingWebView(
        url: String,
        referer: String? = null,
        method: String = "GET",
        requestCallBack: (Request) -> Boolean = { false },
    ): Pair<Request?, List<Request>> = resolveUsingWebView(url, referer, emptyMap(), method, requestCallBack)

    suspend fun resolveUsingWebView(
        url: String,
        referer: String? = null,
        headers: Map<String, String> = emptyMap(),
        method: String = "GET",
        requestCallBack: (Request) -> Boolean = { false },
    ): Pair<Request?, List<Request>> {
        val builder = Request.Builder().url(url)
        headers.forEach { (name, value) -> runCatching { builder.header(name, value) } }
        if (!referer.isNullOrBlank()) builder.header("Referer", referer)
        if (!method.equals("GET", true)) builder.method(method.uppercase(), null.takeIf { method.equals("HEAD", true) })
        return resolveUsingWebView(builder.build(), requestCallBack)
    }

    suspend fun resolveUsingWebView(
        requestCreator: Request,
        requestCallBack: (Request) -> Boolean = { false },
    ): Pair<Request?, List<Request>> {
        val job = linkedMapOf<String, Any?>(
            "url" to requestCreator.url.toString(),
            "method" to requestCreator.method,
            "headers" to requestCreator.headers.toMultimap().mapValues { it.value.lastOrNull() }
                .filterKeys { !it.equals("Referer", true) },
            "referer" to requestCreator.header("Referer"),
            "userAgent" to (userAgent ?: webViewUserAgent),
            "intercept" to interceptUrl.pattern,
            "extra" to additionalUrls.map { it.pattern },
            "script" to script,
            "timeoutMs" to timeout,
        )
        val answer = runCatching {
            runInterruptible(Dispatchers.IO) { WorkerState.browse(mapper.writeValueAsString(job)) }
        }.getOrNull() ?: return null to emptyList()
        val result = runCatching { mapper.readTree(answer) }.getOrNull() ?: return null to emptyList()

        fun request(node: com.fasterxml.jackson.databind.JsonNode?): Request? {
            val target = node?.get("url")?.asText()?.takeIf { it.startsWith("http") } ?: return null
            val headers = Headers.Builder()
            node.get("headers")?.fields()?.forEach { (name, value) -> runCatching { headers.add(name, value.asText()) } }
            return runCatching {
                Request.Builder().url(target).headers(headers.build())
                    .method(node.get("method")?.asText()?.uppercase()?.takeIf { it == "GET" || it == "HEAD" } ?: "GET", null)
                    .build()
            }.getOrNull()
        }

        result.get("scripts")?.forEach { value -> runCatching { scriptCallback?.invoke(value.asText()) } }
        val extra = result.get("extra")?.mapNotNull(::request).orEmpty()
        val intercepted = request(result.get("intercepted"))
        // CloudStream calls back on every request the page made and stops at the first true. The host returns what the
        // page requested in order; the first one the provider accepts stands in for the pattern's match.
        val accepted = result.get("seen")?.asSequence()?.mapNotNull(::request)
            ?.firstOrNull { candidate -> runCatching { requestCallBack(candidate) }.getOrDefault(false) }
        return (intercepted ?: accepted) to extra
    }
}
