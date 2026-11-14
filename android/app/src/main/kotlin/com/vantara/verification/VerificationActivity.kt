package com.vantara.verification

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import androidx.webkit.WebViewCompat
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import android.widget.TextView
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors

/** Only runs in :verification. It never creates or touches the Capacitor WebView. */
class VerificationActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var browser: WebView? = null
    private var endpoint: VerificationPolicy.Endpoint? = null
    private var token = ""
    private var initialClearance: String? = null
    private var selectedCookies: CookieManager? = null
    private var runtimeProfile: String? = null
    /** CloudStream: شبكة المحرك نفسها (DoH وتجزئة SNI) لصفحة التحقق؛ غيره يبقى على شبكة النظام كما هو. */
    @Volatile private var tunnel: VerificationTunnel? = null
    private fun isPublic(host: String): Boolean = tunnel?.let { it.publicAddress(host) != null } ?: VerificationPolicy.publicDns(host)
    private var completed = false
    private var resumed = false
    private var navigations = 0
    /** Same-site host the challenge moved to (e.g. www → ww3); its host-only cf_clearance counts too. */
    private var landed: String? = null
    private fun clearanceNow(origin: String): String? =
        VerificationPolicy.clearance(selectedCookies?.getCookie("$origin/"))
            ?: landed?.takeIf { it != origin }?.let { VerificationPolicy.clearance(selectedCookies?.getCookie("$it/")) }
    private var deadline = 0L
    private val timeout = Runnable { complete("failed", "timeout") }
    private val poll = object : Runnable {
        override fun run() {
            if (completed || !resumed) return
            val current = endpoint ?: return
            val clearance = clearanceNow(current.origin)
            if (clearance != null && clearance != initialClearance) {
                complete("verified", null, clearance)
            } else if (SystemClock.elapsedRealtime() >= deadline) complete("failed", "timeout")
            else main.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        endpoint = VerificationPolicy.endpoint(intent.getStringExtra("url").orEmpty())
        token = intent.getStringExtra("token").orEmpty()
        runtimeProfile = intent.getStringExtra("runtimeProfile")
        if(runtimeProfile?.matches(Regex("runtime_[0-9a-f]{64}"))==false) { complete("failed","invalid_endpoint");return }
        val current = endpoint
        if (current == null || current.host != intent.getStringExtra("host") || current.origin != intent.getStringExtra("origin") || token.length !in 1..100) {
            complete("failed", "invalid_endpoint"); return
        }
        // The data-directory suffix is unavailable before Android 9. Do not share
        // a WebView profile/renderer with the app as a fallback on those versions.
        if (Build.VERSION.SDK_INT < 28) { complete("failed", "unsupported_webview"); return }
        try {
            if (!isolatedReady) { WebView.setDataDirectorySuffix("verification"); isolatedReady = true }
        } catch (_: RuntimeException) { complete("failed", "isolation_unavailable"); return }
        // Recreating the Activity cannot restart a cancelled/rotated challenge.
        if (savedInstanceState != null) { complete("cancelled", "interrupted"); return }
        deadline = SystemClock.elapsedRealtime() + SESSION_MS
        main.postDelayed(timeout, SESSION_MS)
        showHeader(current)
        worker.execute {
            if (runtimeProfile != null && WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE))
                tunnel = runCatching { VerificationTunnel(com.vantara.anime.net.AnimeDns({ true })::lookup).start() }.getOrNull()
            val safe = isPublic(current.host)
            main.post {
                if (!completed && !isFinishing && !isDestroyed) {
                    if (!safe) complete("failed", "unsafe_endpoint")
                    else tunnel?.let { t ->
                        // يُطبَّق على WebView هذه العملية المعزولة وحدها، ويُزال عند الإغلاق
                        runCatching {
                            ProxyController.getInstance().setProxyOverride(ProxyConfig.Builder().addProxyRule("127.0.0.1:${t.port}").build(), mainExecutor) {
                                if (!completed && !isFinishing && !isDestroyed) createBrowser()
                            }
                        }.onFailure { complete("failed", "proxy_unavailable") }
                    } ?: createBrowser()
                }
            }
        }
    }

    private fun showHeader(current: VerificationPolicy.Endpoint) {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(12), dp(8), dp(12), dp(8)) }
        header.addView(Button(this).apply { text = "رجوع / إلغاء"; setOnClickListener { complete("cancelled", "user_cancelled") } })
        header.addView(TextView(this).apply {
            text = "تحقق المصدر: ${intent.getStringExtra("sourceName").orEmpty().take(100)}\n${current.host}"
            setTextColor(Color.BLACK); textSize = 15f; setPadding(dp(12), 0, 0, 0)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        container.addView(header)
        container.addView(TextView(this).apply {
            text = "أكمل التحقق في صفحة المصدر. ستعود تلقائيًا عند نجاحه."
            setTextColor(Color.DKGRAY); setPadding(dp(16), dp(4), dp(16), dp(8))
        })
        if(runtimeProfile!=null)container.addView(Button(this).apply {
            text="تحققت، متابعة"
            setOnClickListener {
                // A previously valid cookie may be unchanged. Only an explicit
                // click may submit it; the host still replays and validates the source request.
                val value=clearanceNow(current.origin)
                if(value!=null)complete("verified",null,value)
            }
        })
        setContentView(container)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createBrowser() {
        val current = endpoint ?: return
        try {
            val view = WebView(this)
            view.isVerticalScrollBarEnabled = false
            view.isHorizontalScrollBarEnabled = false
            browser = view
            val profile=runtimeProfile
            selectedCookies=if(profile!=null) {
                if(!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) { complete("failed","unsupported_profile");return }
                WebViewCompat.setProfile(view,profile)
                WebViewCompat.getProfile(view).cookieManager
            } else CookieManager.getInstance()
            initialClearance=VerificationPolicy.clearance(selectedCookies?.getCookie(current.origin+"/"))
            view.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                intent.getStringExtra("userAgent")?.takeIf { it.isNotBlank() && it.length <= 1024 }?.let { userAgentString = it }
            }
            selectedCookies?.apply { setAcceptCookie(true); setAcceptThirdPartyCookies(view, false) }
            view.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame) return false
                    val target = VerificationPolicy.endpoint(request.url.toString())
                    // A moved site hops between its own subdomains during the challenge; another site stays blocked.
                    val blocked = target == null || !VerificationPolicy.sameSite(current, target) || ++navigations > 30
                    if (blocked) complete("failed", "navigation_blocked")
                    return blocked
                }
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val target = VerificationPolicy.endpoint(request.url.toString())
                    if (target == null || !isPublic(target.host)) {
                        if (request.isForMainFrame) main.post { complete("failed", "unsafe_endpoint") }
                        return WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                    }
                    return null
                }
                override fun onPageStarted(view: WebView, url: String?, icon: android.graphics.Bitmap?) {
                    val target = VerificationPolicy.endpoint(url.orEmpty())
                    if (target == null || !VerificationPolicy.sameSite(current, target)) complete("failed", "navigation_blocked")
                    else if (target.host != current.host) landed = target.origin
                }
                override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                    handler.cancel(); complete("failed", "tls_error")
                }
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) complete("failed", "network_error")
                }
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    // Claim and destroy only this isolated WebView; do not reload or kill any process.
                    complete("failed", "renderer_gone")
                    return true
                }
            }
            val root = (findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as LinearLayout)
            root.addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            view.loadUrl(intent.getStringExtra("url")!!)
            if (resumed) main.post(poll)
        } catch (_: RuntimeException) { complete("failed", "webview_unavailable") }
    }

    private fun complete(state: String, reason: String?, clearance: String? = null) {
        if (completed) return
        if (state == "verified") selectedCookies?.flush()
        completed = true
        main.removeCallbacks(timeout); main.removeCallbacks(poll)
        val result = Intent().putExtra("host", endpoint?.host).putExtra("token", token).putExtra("state", state)
        if (reason != null) result.putExtra("reason", reason)
        if (state == "verified" && clearance != null) result.putExtra("clearance", clearance)
        setResult(if (state == "verified") RESULT_OK else RESULT_CANCELED, result)
        releaseBrowser()
        releaseTunnel()
        finish()
    }

    private fun releaseTunnel() {
        val t = tunnel ?: return
        tunnel = null
        runCatching { ProxyController.getInstance().clearProxyOverride(mainExecutor) {} }
        worker.execute { t.close() }
    }

    private fun releaseBrowser() {
        val view = browser ?: return
        browser = null
        (view.parent as? ViewGroup)?.removeView(view)
        // A dead renderer can throw from stopLoading; destruction must still run.
        runCatching { view.stopLoading() }
        runCatching { view.webViewClient = WebViewClient() }
        runCatching { view.destroy() }
    }
    override fun onResume() { super.onResume(); resumed = true; browser?.onResume(); if (browser != null && !completed) main.post(poll) }
    override fun onPause() { resumed = false; main.removeCallbacks(poll); browser?.onPause(); super.onPause() }
    @Deprecated("Activity back navigation")
    override fun onBackPressed() { complete("cancelled", "user_cancelled") }
    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        releaseBrowser()
        tunnel?.close(); tunnel = null
        worker.shutdownNow()
        super.onDestroy()
    }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    companion object { private const val SESSION_MS = 180_000L; private var isolatedReady = false }
}
