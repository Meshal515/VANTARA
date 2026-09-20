package eu.kanade.tachiyomi.network.interceptor

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

class BrowserVerificationException(message: String) : IOException(message)

internal fun looksLikeBrowserVerification(contentType: String?, html: String): Boolean {
    if (contentType?.contains("text/html", ignoreCase = true) != true) return false
    val text = html.lowercase()
    return (
        "<title>one moment, please...</title>" in text &&
            "please wait while your request is being verified" in text
        ) || (
        "checking your browser" in text && "javascript" in text
        )
}

/**
 * Some Arabic hosts return HTTP 200 for an anti-bot verification document.
 * Parsers then report an empty catalogue, which falsely looks like a broken
 * extension. Detect only strong HTML fingerprints and surface the real cause.
 */
class BrowserVerificationInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        if (!response.isSuccessful) return response
        if (chain.request().method != "GET" && chain.request().method != "HEAD") return response

        val contentType = response.header("Content-Type")
        if (contentType?.contains("text/html", ignoreCase = true) != true) return response

        val sample = response.peekBody(MAX_SAMPLE_BYTES).string()
        if (!looksLikeBrowserVerification(contentType, sample)) return response

        response.close()
        throw BrowserVerificationException(
            "browser verification page returned for ${chain.request().url.host}",
        )
    }

    private companion object {
        const val MAX_SAMPLE_BYTES = 64L * 1024L
    }
}
