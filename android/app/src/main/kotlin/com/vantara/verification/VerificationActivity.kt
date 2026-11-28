package com.vantara.verification

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.widget.Toast
import com.vantara.app.BuildConfig
import com.vantara.verification.VerificationTrace.Event
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
    private val trace = if (BuildConfig.DEBUG) VerificationTrace(SystemClock::elapsedRealtime) else null
    private fun mark(event: Event, code: Int? = null) { trace?.record(event, code) }
    private val worker = Executors.newSingleThreadExecutor()
    private var browser: WebView? = null
    private var endpoint: VerificationPolicy.Endpoint? = null
    private var token = ""
    private var initialClearance: String? = null
    private var selectedCookies: CookieManager? = null
    private var runtimeProfile: String? = null
    /** CloudStream: شبكة المحرك نفسها (DoH وتجزئة SNI) لصفحة التحقق؛ غيره يبقى على شبكة النظام كما هو. */
    private val tunnelLifecycle = Any()
    private var tunnelReleased = false
    @Volatile private var tunnel: VerificationTunnel? = null

    private fun ownTunnel(candidate: VerificationTunnel?) {
        if (candidate == null) return
        val accepted = synchronized(tunnelLifecycle) {
            if (tunnelReleased) false else { tunnel = candidate; true }
        }
        if (!accepted) candidate.close()
    }
    private fun isPublic(host: String): Boolean = tunnel?.let { it.publicAddress(host) != null } ?: VerificationPolicy.publicDns(host)
    private var completed = false
    private var resumed = false
    private var navigations = 0
    private var pageRevision = 0
    private var continueButton: Button? = null
    /** Same-site host the challenge moved to (e.g. www → ww3); its host-only cf_clearance counts too. */
    private var landed: String? = null
    /**
     * الصفحة نفسها فتحت بلا تحدٍّ (لا نموذج Cloudflare ولا «Just a moment»). النجاح كان يُعرف بكوكي **جديد** فقط،
     * فإن كان عند المتصفح المعزول cf_clearance صالح من تحقق سابق فتح الموقع مباشرة وبقي المستخدم عالقًا فيه
     * (يضغط رجوع = إلغاء = يُطلب التحقق من جديد). الآن الكوكي الصالح مع صفحة بلا تحدٍّ نجاح.
     */
    @Volatile private var pageReady = false
    private fun cookieOrigin(origin: String): String = landed ?: origin
    private fun clearanceNow(origin: String): String? =
        // كما في 224: مضيف الطلب أولًا (منه يُقرأ المرجع initialClearance)، ثم مضيف الهبوط. قراءة الهبوط أولًا كانت تقارن
        // كوكي مضيف بمرجع مضيف آخر، فيبدو القديم جديدًا
        VerificationPolicy.clearance(selectedCookies?.getCookie("$origin/"))
            ?: landed?.takeIf { it != origin }?.let { VerificationPolicy.clearance(selectedCookies?.getCookie("$it/")) }
    private var deadline = 0L
    private val timeout = Runnable { complete("failed", "timeout") }
    private val poll = object : Runnable {
        override fun run() {
            if (completed || !resumed) return
            val current = endpoint ?: return
            val clearance = clearanceNow(current.origin)
            continueButton?.isEnabled = pageReady
            // A cookie alone is not evidence that the visible check completed.
            // Source acceptance is still determined by the original request, not this UI.
            if (clearance != null && pageReady) {
                complete("verified", null, clearance)
            } else if (SystemClock.elapsedRealtime() >= deadline) complete("failed", "timeout")
            else main.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.DEBUG) DebugCrashLog.install(this)
        mark(if (savedInstanceState == null) Event.ACTIVITY_CREATE else Event.ACTIVITY_RECREATED)
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
            if ((runtimeProfile != null || intent.getBooleanExtra("engineNetwork", false)) && WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE))
                ownTunnel(runCatching { VerificationTunnel(com.vantara.anime.net.AnimeDns({ true })::lookup).start() }.getOrNull())
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
        // لكل الإضافات (كان لـCloudStream وحدها): بعد أن يفتح الموقع، المستخدم يرجع بنفسه ولا يبقى عالقًا.
        // الكوكي الصالح يُرسَل وإن لم يتغير؛ والمضيف يعيد طلب المصدر ويتحقق منه، فإن بقي التحدي طُلب من جديد.
        continueButton = Button(this).apply {
            text = "متابعة إلى المصدر"
            isEnabled = false
            setOnClickListener {
                if (pageReady) complete("verified", null, clearanceNow(current.origin))
            }
        }
        container.addView(continueButton)
        if (trace != null) container.addView(Button(this).apply {
            text = "نسخ تشخيص التحقق (Debug)"
            setOnClickListener {
                val report = trace.report() +
                    (DebugVerificationLog.read(this@VerificationActivity)?.let { "\nPrevious attempt (debug):\n$it" } ?: "") +
                    (DebugCrashLog.read(this@VerificationActivity)?.let { "\nLast crash (debug):\n$it" } ?: "")
                getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Verification diagnostics", report))
                Toast.makeText(this@VerificationActivity, "نُسخ التشخيص", Toast.LENGTH_SHORT).show()
            }
        })
        setContentView(container)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createBrowser() {
        val current = endpoint ?: return
        try {
            val view = WebView(this)
            mark(Event.WEBVIEW_CREATE)
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
            // لا تغيير لعلامة Sec-CH-UA في الصفحة الظاهرة (انحدار Stable 226، المرجع Stable 224): كانت تعلن «Google Chrome»
            // وبقية بصمة WebView (‎wv وواجهاته) تقول غير ذلك، فيرى Turnstile بصمة متناقضة ويعيد المربع بلا نهاية. المحلّل
            // الصامت وحده يطابقها كما كان قبل 224
            view.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame) return false
                    val target = VerificationPolicy.endpoint(request.url.toString())
                    // A moved site hops between its own subdomains during the challenge; another site stays blocked.
                    val blocked = target == null || !VerificationPolicy.sameSite(current, target) || ++navigations > 30
                    mark(if (blocked) Event.NAVIGATION_BLOCKED else Event.NAVIGATION)
                    if (blocked) complete("failed", "navigation_blocked")
                    return blocked
                }
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val target = VerificationPolicy.endpoint(request.url.toString())
                    if (target == null || !isPublic(target.host)) {
                        mark(if (target == null) {
                            if (request.isForMainFrame) Event.BLOCKED_MAIN_ENDPOINT else Event.BLOCKED_RESOURCE_ENDPOINT
                        } else {
                            if (request.isForMainFrame) Event.BLOCKED_MAIN_DNS else Event.BLOCKED_RESOURCE_DNS
                        })
                        if (request.isForMainFrame) main.post { complete("failed", "unsafe_endpoint") }
                        return WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                    }
                    return null
                }
                override fun onPageStarted(view: WebView, url: String?, icon: android.graphics.Bitmap?) {
                    mark(Event.PAGE_START)
                    val target = VerificationPolicy.endpoint(url.orEmpty())
                    if (target == null || !VerificationPolicy.sameSite(current, target)) complete("failed", "navigation_blocked")
                    else {
                        landed = target.origin
                        pageReady = false
                        continueButton?.isEnabled = false
                        pageRevision++

                    }
                }
                override fun onPageFinished(view: WebView, url: String?) {
                    mark(Event.PAGE_FINISH)
                    val target = VerificationPolicy.endpoint(url.orEmpty()) ?: return
                    if (!VerificationPolicy.sameSite(current, target)) return
                    // صفحة بلا تحدٍّ؟ (نموذج Cloudflare أو Turnstile أو عنوان «لحظة») — تُفحص بعد كل تحميل كامل
                    val revision = pageRevision
                    view.evaluateJavascript(CHALLENGE_PROBE) { r ->
                        if (completed || revision != pageRevision || view.url != url) return@evaluateJavascript
                        pageReady = r == "true"
                        continueButton?.isEnabled = pageReady
                        mark(if (pageReady) Event.PAGE_READY else Event.PAGE_NOT_READY)
                        if (pageReady && resumed && !completed) { main.removeCallbacks(poll); main.post(poll) }
                    }
                }
                override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                    mark(if (isReload) Event.HISTORY_RELOAD else Event.HISTORY_NAVIGATION)
                }
                override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                    val challenged = errorResponse.responseHeaders?.entries?.any {
                        it.key.equals("cf-mitigated", ignoreCase = true) && it.value.equals("challenge", ignoreCase = true)
                    } == true
                    val event = if (request.isForMainFrame) {
                        if (challenged) Event.HTTP_MAIN_CHALLENGE else Event.HTTP_MAIN_ERROR
                    } else {
                        if (challenged) Event.HTTP_RESOURCE_CHALLENGE else Event.HTTP_RESOURCE_ERROR
                    }
                    mark(event, errorResponse.statusCode)
                }
                override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                    mark(Event.TLS_ERROR, error.primaryError)
                    handler.cancel(); complete("failed", "tls_error")
                }
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    mark(if (request.isForMainFrame) Event.NETWORK_MAIN_ERROR else Event.NETWORK_RESOURCE_ERROR, error.errorCode)
                    if (request.isForMainFrame) complete("failed", "network_error")
                }
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    mark(Event.RENDERER_GONE)
                    // Claim and destroy only this isolated WebView; do not reload or kill any process.
                    complete("failed", "renderer_gone")
                    return true
                }
            }
            val root = (findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as LinearLayout)
            root.addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            // كما في Stable 224 (المرجع العامل): لا حذف لـcf_clearance القديم ولا تصفير للمرجع قبل التحميل. الحذف لم يكن يصيب
            // الكوكي الفعلي دائمًا، والتصفير جعل القديم «جديدًا» فأُغلقت النافذة فورًا بـ«تم» بلا صفحة Cloudflare (Debug 3513)
            mark(Event.APP_LOAD_URL)
            view.loadUrl(intent.getStringExtra("url")!!)
            if (resumed) main.post(poll)
        } catch (_: RuntimeException) { complete("failed", "webview_unavailable") }
    }

    private fun complete(state: String, reason: String?, clearance: String? = null) {
        if (completed) return
        mark(when (state) {
            "verified" -> Event.COMPLETE_VERIFIED
            "cancelled" -> Event.COMPLETE_CANCELLED
            else -> Event.COMPLETE_FAILED
        })
        if (trace != null) {
            val e = endpoint
            val now = e?.let { runCatching { clearanceNow(it.origin) }.getOrNull() }
            trace.note("close state=$state reason=${reason ?: "-"} clearance=${now != null} new=${now != null && now != initialClearance} " +
                "hadInitial=${initialClearance != null} pageReady=$pageReady landedOther=${landed != null && landed != e?.origin} " +
                "request{${DebugVerificationLog.describe(e?.let { runCatching { selectedCookies?.getCookie(it.origin + "/") }.getOrNull() }, null)}} " +
                "landed{${landed?.takeIf { it != e?.origin }?.let { DebugVerificationLog.describe(runCatching { selectedCookies?.getCookie("$it/") }.getOrNull(), null) } ?: "-"}}")
        }
        completed = true
        if (state == "verified") selectedCookies?.flush()
        main.removeCallbacks(timeout); main.removeCallbacks(poll)
        val result = Intent().putExtra("host", endpoint?.host).putExtra("token", token).putExtra("state", state)
        if (reason != null) result.putExtra("reason", reason)
        if (state == "verified" && clearance != null) result.putExtra("clearance", clearance)
        if (state == "verified") endpoint?.let { e ->
            val origin = cookieOrigin(e.origin)
            result.putExtra("cookieOrigin", origin)
            // كوكيز المضيفين كليهما: الذي انتهت إليه الصفحة والذي رُفض طلبه (www أو دونها)
            if (runtimeProfile == null) listOf(origin, e.origin).distinct().mapNotNull { selectedCookies?.getCookie("$it/") }
                .flatMap { it.split(';').map(String::trim) }.filter { it.isNotEmpty() }.distinctBy { it.substringBefore('=') }
                .joinToString("; ").take(65536).takeIf { it.isNotEmpty() }?.let { result.putExtra("cookies", it) }
        }
        setResult(if (state == "verified") RESULT_OK else RESULT_CANCELED, result)
        if (trace != null) DebugVerificationLog.start(this, "== Window ==\n" + trace.report())
        releaseBrowser()
        releaseTunnel()
        finish()
    }

    private fun releaseTunnel() {
        val t = synchronized(tunnelLifecycle) {
            tunnelReleased = true
            tunnel.also { tunnel = null }
        } ?: return
        runCatching { ProxyController.getInstance().clearProxyOverride(mainExecutor) {} }
        // Do not enqueue cleanup on the executor that onDestroy is about to stop.
        t.close()
    }

    private fun releaseBrowser() {
        val view = browser ?: return
        mark(Event.WEBVIEW_DESTROY)
        browser = null
        (view.parent as? ViewGroup)?.removeView(view)
        // A dead renderer can throw from stopLoading; destruction must still run.
        runCatching { view.stopLoading() }
        runCatching { view.webViewClient = WebViewClient() }
        runCatching { view.destroy() }
    }
    override fun onResume() { super.onResume(); mark(Event.ACTIVITY_RESUME); resumed = true; browser?.onResume(); if (browser != null && !completed) main.post(poll) }
    override fun onPause() { mark(Event.ACTIVITY_PAUSE); resumed = false; main.removeCallbacks(poll); browser?.onPause(); super.onPause() }
    @Deprecated("Activity back navigation")
    override fun onBackPressed() { complete("cancelled", "user_cancelled") }
    override fun onDestroy() {
        mark(Event.ACTIVITY_DESTROY)
        main.removeCallbacksAndMessages(null)
        releaseBrowser()
        releaseTunnel()
        worker.shutdownNow()
        super.onDestroy()
    }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    companion object {
        private const val SESSION_MS = 180_000L; private var isolatedReady = false
        /** صفحة التحدي: نموذج Cloudflare أو Turnstile أو عنوانه («Just a moment» / «لحظة»)، أو تحدٍّ ما زال يعمل. */
        internal const val CHALLENGE_PROBE = "(function(){try{var d=document;if(!d.body)return false;" +
            "if(d.querySelector('#challenge-form,#challenge-running,#cf-challenge-running,#challenge-stage,.cf-turnstile,[name=\"cf-turnstile-response\"],script[src*=\"challenge-platform\"]'))return false;" +
            "var t=(d.title||'').toLowerCase();if(/just a moment|attention required|لحظة|one more step|checking your browser|ddos-guard/.test(t))return false;" +
            "return d.body.innerText.length>40;}catch(e){return false;}})()"
    }
}
