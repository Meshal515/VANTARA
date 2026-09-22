package eu.kanade.tachiyomi.network.interceptor

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

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
 * Solves HTTP-200 JavaScript verification shells for compatible sources.
 *
 * Unlike Cloudflare, this gate does not advertise a 403/503 or cf-mitigated
 * header. OkHttp receives a perfectly successful HTML document whose only
 * content is "One moment, please". A real attached WebView must execute that
 * JavaScript, receive the verification cookie, then OkHttp retries with the
 * CookieManager-backed cookie jar.
 */
class BrowserVerificationInterceptor(
    private val context: Context,
    private val defaultUserAgentProvider: () -> String,
) : Interceptor {

    private val handler = Handler(Looper.getMainLooper())
    private val solveLock = Any()
    private var lastSolvedHost: String? = null
    private var lastSolvedAt = 0L

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)
        if (!response.isVerificationShell(request)) return response
        response.close()

        synchronized(solveLock) {
            val now = System.currentTimeMillis()
            val recentlySolved =
                request.url.host == lastSolvedHost && now - lastSolvedAt < RECENT_SOLVE_MS

            if (!recentlySolved) {
                if (!solveInWebView(request)) {
                    throw BrowserVerificationException(
                        "browser verification did not clear for ${request.url.host}",
                    )
                }
                lastSolvedHost = request.url.host
                lastSolvedAt = System.currentTimeMillis()
            }

            val retry = chain.proceed(request)
            if (!retry.isVerificationShell(request)) return retry
            retry.close()

            // A stale/host-specific cookie may have survived the first attempt.
            // Give one fresh browser solve before declaring the gate unsolved.
            lastSolvedHost = null
            if (solveInWebView(request)) {
                lastSolvedHost = request.url.host
                lastSolvedAt = System.currentTimeMillis()
                val finalRetry = chain.proceed(request)
                if (!finalRetry.isVerificationShell(request)) return finalRetry
                finalRetry.close()
            }

            throw BrowserVerificationException(
                "browser verification page persisted for ${request.url.host}",
            )
        }
    }

    private fun Response.isVerificationShell(request: Request): Boolean {
        if (!isSuccessful) return false
        if (request.method != "GET" && request.method != "HEAD") return false
        val contentType = header("Content-Type")
        if (contentType?.contains("text/html", ignoreCase = true) != true) return false
        return looksLikeBrowserVerification(
            contentType,
            peekBody(MAX_SAMPLE_BYTES).string(),
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun solveInWebView(request: Request): Boolean {
        val latch = CountDownLatch(1)
        val solved = AtomicBoolean(false)
        val active = AtomicBoolean(true)
        val webView = AtomicReference<WebView?>(null)
        val userAgent = request.header("User-Agent") ?: defaultUserAgentProvider()

        handler.post {
            if (!active.get()) return@post
            val activity = WebViewActivityHolder.get()
            val view = WebView(activity ?: context)
            webView.set(view)
            view.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                userAgentString = userAgent
            }
            CookieManager.getInstance().apply {
                setAcceptCookie(true)
                setAcceptThirdPartyCookies(view, true)
            }
            (activity?.window?.decorView as? ViewGroup)?.let { decor ->
                view.layoutParams = ViewGroup.LayoutParams(1, 1)
                view.alpha = 0f
                decor.addView(view)
            }

            view.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    if (!active.get()) return
                    view.evaluateJavascript(VERIFY_STATE_JS) { raw ->
                        if (!active.get()) return@evaluateJavascript
                        // JSON-encoded JS string. "ok" means the verification
                        // shell is gone and a real destination document loaded.
                        if (raw == "\"ok\"") {
                            CookieManager.getInstance().flush()
                            solved.set(true)
                            latch.countDown()
                        }
                    }
                }

                override fun onRenderProcessGone(
                    view: WebView,
                    detail: RenderProcessGoneDetail,
                ): Boolean {
                    webView.compareAndSet(view, null)
                    latch.countDown()
                    destroyOnMain(view)
                    return true
                }
            }
            view.loadUrl(request.url.toString(), mapOf("User-Agent" to userAgent))
        }

        latch.await(SOLVE_TIMEOUT_SEC, TimeUnit.SECONDS)
        active.set(false)
        destroyOnMain(webView.getAndSet(null))
        return solved.get()
    }

    private fun destroyOnMain(view: WebView?) {
        handler.post {
            view?.let {
                (it.parent as? ViewGroup)?.removeView(it)
                it.stopLoading()
                it.destroy()
            }
        }
    }

    private companion object {
        const val MAX_SAMPLE_BYTES = 64L * 1024L
        const val SOLVE_TIMEOUT_SEC = 35L
        const val RECENT_SOLVE_MS = 60_000L

        const val VERIFY_STATE_JS =
            "(function(){" +
                "var t=(document.title||'').toLowerCase();" +
                "var b=((document.body&&document.body.innerText)||'').toLowerCase();" +
                "var wait=t.indexOf('one moment, please')>=0||" +
                "b.indexOf('please wait while your request is being verified')>=0||" +
                "(b.indexOf('checking your browser')>=0&&b.indexOf('javascript')>=0);" +
                "return wait?'wait':'ok';" +
            "})()"
    }
}
