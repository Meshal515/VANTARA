package com.vantara.runtime

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * CloudStream's hidden browser (WebViewResolver) for an isolated provider: the contract between the worker's job and
 * VANTARA's hidden browser in the host.
 *
 * Everything in the job comes from provider code, so it is checked here before a WebView sees it: a public HTTP(S)
 * page only (the source's own origins when its scope is not the public internet), bounded headers, script and
 * patterns, a timeout within the link budget, and every pattern match bounded in work (a provider's regular
 * expression runs in the app process; a catastrophic one must not hang it). Only requests the page made come back,
 * bounded to fit the IPC text limit: never cookies or page content.
 */
object RuntimeBrowser {
    data class Job(
        val url: String,
        val referer: String?,
        val headers: Map<String, String>,
        val userAgent: String,
        val intercept: Regex?,
        val extra: List<Regex>,
        val script: String?,
        val timeoutMs: Long,
    )
    data class Seen(val url: String, val method: String, val headers: Map<String, String>)
    data class Result(val intercepted: Seen?, val extra: List<Seen>, val seen: List<Seen>, val scripts: List<String>)

    /** The app's hidden browser. Blocking; never called on the main thread. null = no browser available now. */
    fun interface Engine { fun open(job: Job): Result? }

    const val MIN_TIMEOUT_MS = 3_000L
    /** Within the embed budget of the link collection (one server's page). */
    const val MAX_TIMEOUT_MS = 30_000L
    private const val MAX_HEADERS = 32
    private const val MAX_PATTERN = 1_024
    private const val MAX_EXTRA = 16
    private const val MAX_SCRIPT = 16 * 1024
    private const val MAX_URL = 4_096
    /** IPC text limit is 64 KiB; the answer stays well within it. */
    private const val MAX_ANSWER = 56 * 1024
    private const val MATCH_BUDGET = 200_000
    private val FORBIDDEN_HEADERS = setOf("cookie", "host", "content-length", "connection", "proxy-authorization", "authorization")

    fun parse(json: String, allowedOrigins: Set<String>, defaultUserAgent: String): Job {
        val root = runCatching { RuntimeJson.parse(json).jsonObject }.getOrNull() ?: throw IllegalArgumentException("INVALID_BROWSER_JOB")
        fun text(name: String) = (root[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
        val url = page(text("url"), allowedOrigins)
        val method = text("method")?.uppercase() ?: "GET"
        if (method != "GET") throw IllegalArgumentException("BROWSER_METHOD_UNSUPPORTED")
        val referer = text("referer")?.takeIf { it.length <= MAX_URL && (it.startsWith("https://") || it.startsWith("http://")) }
        val headers = (root["headers"] as? JsonObject).orEmpty().entries.asSequence()
            .mapNotNull { (name, value) ->
                val v = (value as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
                if (name.lowercase() in FORBIDDEN_HEADERS || name.equals("Referer", true) || name.equals("User-Agent", true)) return@mapNotNull null
                if (!name.matches(Regex("[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}")) || v.length > 2_048 || v.any { it.code < 32 && it != '\t' }) return@mapNotNull null
                name to v
            }.take(MAX_HEADERS).toMap()
        val userAgent = text("userAgent")?.takeIf { it.isNotBlank() && it.length <= 1_024 && it.none { c -> c.code < 32 } } ?: defaultUserAgent
        val intercept = text("intercept")?.let(::pattern)
        val extra = (root["extra"] as? JsonArray).orEmpty().asSequence()
            .mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.let(::pattern) }.take(MAX_EXTRA).toList()
        val script = text("script")?.takeIf { it.isNotBlank() }?.also { if (it.length > MAX_SCRIPT) throw IllegalArgumentException("BROWSER_SCRIPT_LIMIT") }
        val timeout = ((root["timeoutMs"] as? JsonPrimitive)?.longOrNull ?: MAX_TIMEOUT_MS).coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
        return Job(url, referer, headers, userAgent, intercept, extra, script, timeout)
    }

    private fun pattern(value: String): Regex {
        if (value.isEmpty() || value.length > MAX_PATTERN) throw IllegalArgumentException("BROWSER_PATTERN_LIMIT")
        return runCatching { Regex(value) }.getOrElse { throw IllegalArgumentException("BROWSER_PATTERN_INVALID") }
    }

    /** The page a provider may open: public HTTP(S), no credentials, no local or private host. */
    internal fun page(value: String?, allowedOrigins: Set<String>): String {
        val url = value?.takeIf { it.length <= MAX_URL && it.none { c -> c.code <= 32 || c.code == 127 } } ?: throw IllegalArgumentException("INVALID_ENDPOINT")
        val uri = runCatching { java.net.URI(url) }.getOrNull() ?: throw IllegalArgumentException("INVALID_ENDPOINT")
        val scheme = uri.scheme?.lowercase()
        val host = uri.host?.lowercase()?.removeSuffix(".")
        if ((scheme != "https" && scheme != "http") || host.isNullOrEmpty() || uri.rawUserInfo != null) throw IllegalArgumentException("INVALID_ENDPOINT")
        if (host == "localhost" || listOf(".local", ".localhost", ".internal", ".lan", ".invalid", ".home", ".onion").any(host::endsWith) ||
            !host.contains('.') || host.startsWith("[") || privateAddress(host)) throw IllegalArgumentException("INVALID_ENDPOINT")
        if ("*" !in allowedOrigins && "https://$host" !in allowedOrigins) throw IllegalArgumentException("ORIGIN_NOT_ALLOWED")
        return url
    }

    private fun privateAddress(host: String): Boolean {
        val parts = host.split('.').takeIf { it.size == 4 && it.all { p -> p.toIntOrNull() in 0..255 } }?.map(String::toInt) ?: return false
        val (a, b) = parts[0] to parts[1]
        return a == 0 || a == 10 || a == 127 || a >= 224 || (a == 100 && b in 64..127) || (a == 169 && b == 254) ||
            (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 198 && b in 18..19)
    }

    /** A provider's pattern against a URL, with a bound on the work (a catastrophic pattern reads as no match). */
    fun matches(regex: Regex, url: String): Boolean = try {
        regex.containsMatchIn(Budgeted(url.take(MAX_URL), intArrayOf(MATCH_BUDGET)))
    } catch (_: BudgetExhausted) { false }
    catch (_: StackOverflowError) { false }

    private object BudgetExhausted : RuntimeException() { private fun readResolve(): Any = BudgetExhausted }
    private class Budgeted(private val text: CharSequence, private val left: IntArray) : CharSequence {
        override val length get() = text.length
        override fun get(index: Int): Char { if (--left[0] < 0) throw BudgetExhausted; return text[index] }
        override fun subSequence(startIndex: Int, endIndex: Int): CharSequence = Budgeted(text.subSequence(startIndex, endIndex), left)
        override fun toString() = text.toString()
    }

    fun encode(result: Result): String {
        fun seen(s: Seen, headers: Boolean) = buildJsonObject {
            put("url", s.url.take(MAX_URL)); put("method", s.method.take(16))
            if (headers) put("headers", buildJsonObject {
                s.headers.entries.filter { it.key.lowercase() !in FORBIDDEN_HEADERS }.take(MAX_HEADERS)
                    .forEach { (k, v) -> put(k.take(64), v.take(2_048)) }
            })
        }
        // Fits the IPC text limit by giving up the least useful part first: the plain request list, then the extra
        // matches, then script results. The intercepted request is always kept whole (it is the answer).
        var seenCount = result.seen.size.coerceAtMost(200)
        var extraCount = result.extra.size.coerceAtMost(MAX_EXTRA * 4)
        var scripts = result.scripts.take(4).map { it.take(8 * 1024) }
        while (true) {
            val answer = buildJsonObject {
                put("intercepted", result.intercepted?.let { seen(it, true) } ?: JsonNull)
                put("extra", buildJsonArray { result.extra.take(extraCount).forEach { add(seen(it, true)) } })
                put("seen", buildJsonArray { result.seen.take(seenCount).forEach { add(seen(it, false)) } })
                put("scripts", buildJsonArray { scripts.forEach { add(JsonPrimitive(it)) } })
            }.toString()
            when {
                answer.length <= MAX_ANSWER -> return answer
                seenCount > 0 -> seenCount /= 2
                extraCount > 0 -> extraCount /= 2
                scripts.isNotEmpty() -> scripts = emptyList()
                else -> return buildJsonObject {
                    put("intercepted", result.intercepted?.let { seen(it.copy(headers = emptyMap()), true) } ?: JsonNull)
                    put("extra", JsonArray(emptyList())); put("seen", JsonArray(emptyList())); put("scripts", JsonArray(emptyList()))
                }.toString()
            }
        }
    }

    /** Diagnostic line: host and counts only. */
    fun describe(job: Job, result: Result?, ms: Long): String =
        "BROWSE host=${runCatching { java.net.URI(job.url).host }.getOrNull()} intercepted=${result?.intercepted != null} " +
            "extra=${result?.extra?.size ?: 0} seen=${result?.seen?.size ?: 0} ms=$ms"
}
