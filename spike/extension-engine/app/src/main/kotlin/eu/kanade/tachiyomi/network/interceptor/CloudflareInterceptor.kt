/*
 * Vendored Tachiyomi network API. Inspired by Mihon's WebView-based
 * CloudflareInterceptor (Apache 2.0 — see NOTICE), extended to also handle
 * fingerprint-gated image CDNs that issue no solvable cookie.
 *
 * When a request is rejected by a Cloudflare challenge (HTTP 403/503 from
 * `cloudflare`, or a `cf-mitigated: challenge` header) we recover in two ways,
 * using a WebView attached to the live Activity window (a detached WebView has
 * its JS timers throttled and never completes the challenge):
 *
 *  1. Cookie solve — load the host root (an HTML document) so Cloudflare serves
 *     the managed/Turnstile challenge, let it run, and poll the shared
 *     [AndroidCookieJar] for the host-scoped `cf_clearance` cookie. Once set,
 *     the OkHttp retry (and every later request to that host) carries it.
 *
 *  2. WebView byte-fetch — some image CDNs (e.g. s2.<site>) gate on the client's
 *     TLS/HTTP fingerprint rather than a cookie: the real WebView is served the
 *     image directly while OkHttp is permanently 403'd, and no `cf_clearance` is
 *     ever issued. For those we load the asset in the WebView (which passes) and
 *     read its bytes via a same-origin JS `fetch`, returning them as a synthetic
 *     OkHttp response so the rest of the app is none the wiser.
 *
 * The WebView User-Agent MUST match the OkHttp User-Agent or a cf_clearance
 * cookie is rejected, so we reuse the request's User-Agent for the WebView.
 */
package eu.kanade.tachiyomi.network.interceptor

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.UserAgentMetadata
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import dev.vantara.spike.ChromeUserAgent
import eu.kanade.tachiyomi.network.AndroidCookieJar
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import java.io.IOException
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class CloudflareInterceptor(
    private val context: Context,
    private val cookieManager: AndroidCookieJar,
    private val defaultUserAgentProvider: () -> String,
) : Interceptor {

    private val handler = Handler(Looper.getMainLooper())

    /** Serializes WebView work and remembers what we've learned per host. */
    private val solveLock = Any()
    private var lastSolvedHost: String? = null
    private var lastSolvedAt = 0L

    /** Hosts known to gate on fingerprint (no cookie possible) → byte-fetch. */
    private val byteFetchHosts = Collections.synchronizedSet(mutableSetOf<String>())

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)

        if (!response.isChallenge()) {
            return response
        }

        Log.i(TAG, "Cloudflare challenge detected for ${request.url}")
        response.close()

        synchronized(solveLock) {
            val host = request.url.host

            // A concurrent/earlier solve may have already cleared this host.
            if (hasClearance(request.url)) {
                val retry = chain.proceed(request)
                if (!retry.isChallenge()) return retry
                retry.close()
            }

            // Host previously found to be fingerprint-gated: skip the (useless)
            // cookie solve and fetch the bytes through the browser engine.
            if (host in byteFetchHosts) {
                return byteFetchResponse(request) ?: throw cloudflareError(request)
            }

            // Try to obtain a cf_clearance cookie for the whole host.
            val now = System.currentTimeMillis()
            val recentlyTried = host == lastSolvedHost && now - lastSolvedAt < RECENT_SOLVE_MS
            if (!recentlyTried) {
                lastSolvedHost = host
                lastSolvedAt = now
                when (solveClearance(request)) {
                    SolveOutcome.SOLVED -> {
                        val retry = chain.proceed(request)
                        if (!retry.isChallenge()) return retry
                        retry.close()
                        // Cookie obtained but the host still blocks OkHttp → fingerprint.
                    }
                    // A human is needed. The byte-fetch below would only sit in
                    // front of the same widget for another timeout.
                    SolveOutcome.INTERACTIVE -> throw interactiveError(request)
                    SolveOutcome.RENDERER_GONE -> throw rendererGoneError(request)
                    SolveOutcome.NOT_A_CHALLENGE, SolveOutcome.TIMEOUT -> Unit
                }
            }

            // Fall back to fetching the resource through the WebView.
            val fetched = byteFetchResponse(request)
            if (fetched != null) {
                byteFetchHosts.add(host)
                return fetched
            }
            throw cloudflareError(request)
        }
    }

    private fun cloudflareError(request: Request): IOException =
        CloudflareBypassException("Failed to bypass Cloudflare for ${request.url.host}", interactive = false)

    /**
     * Cloudflare asked for a human: the page posted `interactiveBegin`, which
     * means a checkbox or Turnstile widget that a hidden WebView will never
     * complete. Give up at once rather than waiting out the timeout; the app can
     * open the site in a visible WebView where the user solves it in seconds,
     * and the resulting cookie is shared with OkHttp.
     */
    private fun interactiveError(request: Request): IOException =
        CloudflareBypassException(
            "Cloudflare wants a human check for ${request.url.host}; open the site in the WebView to pass it",
            interactive = true,
        )

    private fun rendererGoneError(request: Request): IOException =
        CloudflareBypassException(
            "WebView renderer terminated while checking ${request.url.host}; source probe can resume safely",
            interactive = false,
        )

    private fun hasClearance(url: HttpUrl): Boolean =
        cookieManager.get(url).any { it.name == "cf_clearance" }

    /**
     * What counts as "Cloudflare is challenging us", not merely "Cloudflare said no".
     *
     * A challenge page always carries `cf-mitigated: challenge` — the header
     * Cloudflare documents for exactly this purpose and the only signal Mihon
     * uses. A bare 403/503 from a Cloudflare-fronted origin is a WAF block or a
     * rate limit: no WebView will ever turn it into a cookie, and treating it as
     * a challenge cost 20–40 s of WebView work per request before the same 403
     * came back. Those now return immediately as ordinary errors.
     *
     * The one exception is image requests. Some image CDNs gate on the client's
     * TLS fingerprint and 403 OkHttp without any challenge; the WebView is served
     * the bytes directly, so for those we still fall through to the byte-fetch.
     */
    private fun Response.isChallenge(): Boolean {
        val fromCloudflare = header("Server") in SERVER_CHECK
        if (!fromCloudflare) return false
        if (header("cf-mitigated").equals("challenge", ignoreCase = true)) return true
        return code in ERROR_CODES && request.isImageRequest()
    }

    private fun Request.isImageRequest(): Boolean {
        if (header("Accept")?.startsWith("image/") == true) return true
        val path = url.encodedPath.lowercase()
        return IMAGE_EXTENSIONS.any { path.endsWith(it) }
    }

    /**
     * Loads the host root so Cloudflare serves a solvable managed challenge and,
     * once solved, issues a host-scoped cf_clearance. Bails fast if the root is
     * not actually a challenge page (e.g. a bare 403 from an image-only CDN).
     */
    /** Why the WebView solve stopped, when it did not produce a cookie. */
    private enum class SolveOutcome { SOLVED, NOT_A_CHALLENGE, INTERACTIVE, RENDERER_GONE, TIMEOUT }

    @SuppressLint("SetJavaScriptEnabled")
    private fun solveClearance(request: Request): SolveOutcome {
        val latch = CountDownLatch(1)
        val webView = AtomicReference<WebView?>(null)
        val outcome = AtomicReference(SolveOutcome.TIMEOUT)
        val active = AtomicBoolean(true)
        var challengeFound = false
        val interactive = AtomicBoolean(false)
        val rootUrl = request.url.newBuilder()
            .encodedPath("/")
            .query(null)
            .fragment(null)
            .build()
            .toString()
        val cookieUrl = request.url
        val userAgent = request.header("User-Agent") ?: defaultUserAgentProvider()
        // Drop any stale clearance so we detect the *appearance* of a fresh one.
        cookieManager.remove(request.url, COOKIE_NAMES, 0)
        Log.i(TAG, "Solving Cloudflare clearance via $rootUrl")

        fun isBypassed(): Boolean = cookieManager.get(cookieUrl).any { it.name == "cf_clearance" }
        fun finish(result: SolveOutcome) {
            outcome.set(result)
            latch.countDown()
        }

        val poller = object : Runnable {
            override fun run() {
                if (isBypassed()) {
                    finish(SolveOutcome.SOLVED)
                } else if (latch.count > 0) {
                    handler.postDelayed(this, POLL_MS)
                }
            }
        }
        handler.post {
            if (!active.get()) return@post
            val view = newWebView(userAgent)
            webView.set(view)
            if (!active.get()) {
                destroyOnMain(webView.getAndSet(null))
                return@post
            }
            // Cloudflare's challenge script posts a message the moment it decides
            // it needs the user (checkbox / Turnstile). The JS interface callback
            // runs on a binder thread; latch.countDown() publishes the write.
            view.addJavascriptInterface(
                object {
                    @JavascriptInterface
                    fun interactiveDetected() {
                        Log.i(TAG, "Cloudflare challenge for ${request.url.host} needs interaction")
                        interactive.set(true)
                        showInteractive(view, request.url.host)
                    }
                },
                "kagari",
            )
            view.webViewClient = object : WebViewClient() {
                override fun onReceivedHttpError(
                    view: WebView,
                    req: WebResourceRequest,
                    errorResponse: WebResourceResponse,
                ) {
                    if (!req.isForMainFrame) return
                    // A challenge page is an HTTP error carrying `cf-mitigated: challenge`
                    // — Cloudflare's documented signal. Any other main-frame error
                    // means the root is just blocked: no cookie will ever appear.
                    val mitigated = errorResponse.responseHeaders
                        ?.entries
                        ?.firstOrNull { it.key.equals("cf-mitigated", ignoreCase = true) }
                        ?.value
                    if (mitigated.equals("challenge", ignoreCase = true)) {
                        challengeFound = true
                    } else if (!challengeFound) {
                        finish(SolveOutcome.NOT_A_CHALLENGE)
                    }
                }

                override fun onPageFinished(view: WebView, url: String) {
                    if (isBypassed()) {
                        finish(SolveOutcome.SOLVED)
                        return
                    }
                    if (!challengeFound) {
                        // Loaded cleanly without a challenge and without a cookie:
                        // the block is not something a WebView can clear.
                        finish(SolveOutcome.NOT_A_CHALLENGE)
                        return
                    }
                    view.evaluateJavascript(INTERACTIVE_LISTENER_JS, null)
                }

                override fun onRenderProcessGone(
                    view: WebView,
                    detail: RenderProcessGoneDetail,
                ): Boolean {
                    Log.e(
                        TAG,
                        "WebView renderer gone during Cloudflare solve; didCrash=${detail.didCrash()} host=${request.url.host}",
                    )
                    webView.compareAndSet(view, null)
                    outcome.set(SolveOutcome.RENDERER_GONE)
                    latch.countDown()
                    destroyOnMain(view)
                    // Android's contract: returning true means the app handled
                    // renderer death. Returning false lets WebView terminate us.
                    return true
                }
            }
            view.loadUrl(rootUrl, mapOf("User-Agent" to userAgent))
            handler.postDelayed(poller, POLL_MS)
        }
        // التحدي الصامت يأخذ مهلة قصيرة. إذا طلب Cloudflare إنسانًا، فالـWebView
        // يظهر بالحجم الكامل ونمنح المستخدم وقتًا واقعيًّا لإكمال التحقق.
        latch.await(TIMEOUT_SEC, TimeUnit.SECONDS)
        if (outcome.get() == SolveOutcome.TIMEOUT && interactive.get()) {
            latch.await(INTERACTIVE_TIMEOUT_SEC - TIMEOUT_SEC, TimeUnit.SECONDS)
        }
        active.set(false)
        // Cookie may have landed between the last poll and the timeout.
        if (outcome.get() == SolveOutcome.TIMEOUT && isBypassed()) outcome.set(SolveOutcome.SOLVED)
        if (outcome.get() == SolveOutcome.TIMEOUT && interactive.get()) outcome.set(SolveOutcome.INTERACTIVE)
        destroyOnMain(webView.getAndSet(null)) { handler.removeCallbacks(poller) }
        val result = outcome.get()
        if (result == SolveOutcome.SOLVED) {
            CookieManager.getInstance().flush()
            Log.i(TAG, "Cloudflare clearance obtained for ${request.url.host}")
        } else {
            Log.i(TAG, "Cloudflare solve for ${request.url.host} ended: $result")
        }
        return result
    }

    /**
     * Loads the exact asset in the WebView (which passes Cloudflare's fingerprint
     * gate) and reads its bytes with a same-origin JS fetch, returning them as a
     * synthetic OkHttp response. Only used as a fallback for GET requests.
     */
    @SuppressLint("SetJavaScriptEnabled")
    private fun byteFetchResponse(request: Request): Response? {
        if (request.method != "GET") return null

        val latch = CountDownLatch(1)
        val webView = AtomicReference<WebView?>(null)
        val dataUrl = AtomicReference<String?>(null)
        val active = AtomicBoolean(true)

        val url = request.url.toString()
        val userAgent = request.header("User-Agent") ?: defaultUserAgentProvider()
        val referer = request.header("Referer")
        Log.d(TAG, "Fetching via WebView $url")

        handler.post {
            if (!active.get()) return@post
            val view = newWebView(userAgent)
            webView.set(view)
            if (!active.get()) {
                destroyOnMain(webView.getAndSet(null))
                return@post
            }
            view.addJavascriptInterface(
                object {
                    @JavascriptInterface
                    fun onData(data: String) {
                        dataUrl.set(data)
                        latch.countDown()
                    }

                    @JavascriptInterface
                    fun onError(message: String) {
                        Log.w(TAG, "WebView fetch failed: $message")
                        latch.countDown()
                    }
                },
                "ImgFetch",
            )
            view.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    view.evaluateJavascript(BYTE_FETCH_JS, null)
                }

                override fun onRenderProcessGone(
                    view: WebView,
                    detail: RenderProcessGoneDetail,
                ): Boolean {
                    Log.e(
                        TAG,
                        "WebView renderer gone during byte fetch; didCrash=${detail.didCrash()} host=${request.url.host}",
                    )
                    webView.compareAndSet(view, null)
                    latch.countDown()
                    destroyOnMain(view)
                    return true
                }
            }
            val headers = mutableMapOf("User-Agent" to userAgent)
            if (!referer.isNullOrBlank()) headers["Referer"] = referer
            view.loadUrl(url, headers)
        }

        latch.await(TIMEOUT_SEC, TimeUnit.SECONDS)
        active.set(false)
        destroyOnMain(webView.getAndSet(null))

        val data = dataUrl.get() ?: return null
        val comma = data.indexOf(',')
        if (comma <= 0) return null
        val meta = data.substring(0, comma)
        val bytes = try {
            Base64.decode(data.substring(comma + 1), Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "Bad base64 from WebView fetch", e)
            return null
        }
        if (bytes.isEmpty()) return null

        val mime = meta.substringAfter("data:", "").substringBefore(";").ifBlank { "image/jpeg" }
        Log.d(TAG, "WebView fetch ok bytes=${bytes.size} type=$mime for ${request.url}")
        return Response.Builder()
            .request(request)
            .protocol(Protocol.HTTP_1_1)
            .code(200)
            .message("OK")
            .header("Content-Type", mime)
            .body(bytes.toResponseBody(mime.toMediaTypeOrNull()))
            .build()
    }

    /**
     * Cloudflare's challenge script drops old Chromium builds outright, so an
     * outdated Android System WebView solves nothing, forever. Say so once
     * instead of leaving the user with "didn't respond" on every source.
     */
    private fun warnIfWebViewOutdated() {
        if (warnedOutdated) return
        val version = WebView.getCurrentWebViewPackage()?.versionName ?: return
        val major = version.substringBefore('.').toIntOrNull() ?: return
        if (major >= MINIMUM_WEBVIEW_VERSION) return
        warnedOutdated = true
        handler.post {
            Toast.makeText(
                context,
                "Android System WebView $version is too old to pass Cloudflare checks. Update it from the Play Store.",
                Toast.LENGTH_LONG,
            ).show()
        }
    }

    @Volatile
    private var warnedOutdated = false

    @SuppressLint("SetJavaScriptEnabled")
    private fun newWebView(userAgent: String): WebView {
        warnIfWebViewOutdated()
        // Prefer the live Activity as context and attach to its window so the
        // challenge JS actually runs; fall back to app context when backgrounded.
        val activity = WebViewActivityHolder.get()
        val view = WebView(activity ?: context)
        @Suppress("DEPRECATION")
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            userAgentString = userAgent
        }
        setMatchingUserAgentMetadata(view, userAgent)
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(view, true)
        }
        (activity?.window?.decorView as? ViewGroup)?.let { decor ->
            view.layoutParams = ViewGroup.LayoutParams(1, 1)
            view.alpha = 0f
            decor.addView(view)
        }
        return view
    }

    /** Make a human-solvable Turnstile visible instead of failing a hidden 1×1 browser. */
    private fun showInteractive(view: WebView, host: String) {
        handler.post {
            view.alpha = 1f
            view.layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            view.setBackgroundColor(android.graphics.Color.WHITE)
            view.bringToFront()
            Toast.makeText(
                context,
                "أكمل تحقق Cloudflare لـ $host، وسيعود الفحص تلقائيًا",
                Toast.LENGTH_LONG,
            ).show()
        }
    }

    /**
     * `settings.userAgentString` وحده غير كافٍ في Chromium الحديث: Sec-CH-UA
     * يبقى معلنًا عن Android WebView. Cloudflare يرى التناقض ويحجب الطلب.
     */
    private fun setMatchingUserAgentMetadata(view: WebView, userAgent: String) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)) return
        val chrome = ChromeUserAgent.parse(userAgent) ?: return
        try {
            val current = WebSettingsCompat.getUserAgentMetadata(view.settings)
            val brands = current.brandVersionList.map { item ->
                val brand = when (item.brand) {
                    "Android WebView" -> "Google Chrome"
                    "Chromium" -> "Chromium"
                    else -> return@map item
                }
                UserAgentMetadata.BrandVersion.Builder()
                    .setBrand(brand)
                    .setMajorVersion(chrome.major)
                    .setFullVersion(chrome.full)
                    .build()
            }
            WebSettingsCompat.setUserAgentMetadata(
                view.settings,
                UserAgentMetadata.Builder(current)
                    .setBrandVersionList(brands)
                    .setFullVersion(chrome.full)
                    .build(),
            )
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to align WebView user-agent metadata", t)
        }
    }

    private fun destroyOnMain(view: WebView?, also: () -> Unit = {}) {
        handler.post {
            also()
            view?.let {
                (it.parent as? ViewGroup)?.removeView(it)
                it.stopLoading()
                it.removeJavascriptInterface("ImgFetch")
                it.removeJavascriptInterface("kagari")
                it.destroy()
            }
        }
    }

    companion object {
        private const val TAG = "CloudflareInterceptor"
        private const val TIMEOUT_SEC = 20L
        private const val INTERACTIVE_TIMEOUT_SEC = 120L
        private const val POLL_MS = 400L
        private const val RECENT_SOLVE_MS = 15_000L
        private const val MAX_WEBVIEW_IMAGE_BYTES = 12 * 1024 * 1024
        private val ERROR_CODES = listOf(403, 503)
        private val SERVER_CHECK = listOf("cloudflare-nginx", "cloudflare")
        private val COOKIE_NAMES = listOf("cf_clearance")
        private val IMAGE_EXTENSIONS = listOf(".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")

        /** Mihon's floor; older Chromium is rejected by the challenge script itself. */
        private const val MINIMUM_WEBVIEW_VERSION = 118

        /**
         * Cloudflare's challenge page announces an interactive step by posting
         * `{source: "cloudflare-challenge", event: "interactiveBegin"}` to the
         * window. Same hook Mihon uses.
         */
        private const val INTERACTIVE_LISTENER_JS =
            "addEventListener('message',function(e){var d=e.data;" +
                "if(d&&d.source==='cloudflare-challenge'&&d.event==='interactiveBegin'){" +
                "kagari.interactiveDetected()}})"

        /**
         * Reads the current document's bytes (same-origin) as a data URL. Only a
         * successful response counts: the WebView may itself have been served the
         * block page, and handing that back as a 200 would put an HTML error page
         * where the app expects an image.
         */
        private val BYTE_FETCH_JS =
            "fetch(location.href).then(function(r){" +
                "if(!r.ok){ImgFetch.onError('http '+r.status);return null}" +
                "return r.blob()})" +
                ".then(function(b){if(!b)return;" +
                "if(b.size>$MAX_WEBVIEW_IMAGE_BYTES){ImgFetch.onError('too-large '+b.size);return;}" +
                "var f=new FileReader();" +
                "f.onload=function(){ImgFetch.onData(f.result)};" +
                "f.onerror=function(){ImgFetch.onError('read')};" +
                "f.readAsDataURL(b)}).catch(function(e){ImgFetch.onError(''+e)})"
    }
}

/**
 * A Cloudflare challenge the hidden WebView could not clear. [interactive] is
 * true when Cloudflare explicitly asked for a human, which the app turns into
 * an "open in WebView" prompt rather than a generic "didn't respond".
 */
class CloudflareBypassException(message: String, val interactive: Boolean) : IOException(message)
