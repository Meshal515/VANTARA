package com.vantara.anime.hosts

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import eu.kanade.tachiyomi.network.interceptor.WebViewActivityHolder
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeoutOrNull

/**
 * متصفح مخفي 1×1 يفتح صفحة سيرفر (hgcloud، videa، …) كما يفتحها متصفح، ويلتقط
 * أول طلب فيديو تصدره الصفحة مع ترويساته. لا نحتاج فهم سكربت السيرفر ولا
 * تشغيله خارج المتصفح؛ حين يتغيّر السيرفر يبقى هذا يعمل.
 *
 * لا يُعرض للمستخدم أبدًا، ويُدمَّر فور الالتقاط أو انتهاء المهلة.
 */
class WebViewSniffer(
    private val context: Context,
    private val userAgent: () -> String,
    private val timeoutMs: Long = 20_000,
) : Sniffer {

    private val main = Handler(Looper.getMainLooper())

    /** حلقة بستة سيرفرات لا تفتح ستة متصفحات معًا على جوال. */
    private val slots = Semaphore(3)

    override suspend fun sniff(url: String, referer: String?): Stream? = slots.withPermit { sniffNow(url, referer) }

    private suspend fun sniffNow(url: String, referer: String?): Stream? {
        val found = CompletableDeferred<Stream>()
        var view: WebView? = null
        main.post { view = open(url, referer, found) }
        return try {
            withTimeoutOrNull(timeoutMs) { found.await() }
        } finally {
            main.post {
                view?.let { v ->
                    (v.parent as? ViewGroup)?.removeView(v)
                    v.stopLoading()
                    v.destroy()
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun open(url: String, referer: String?, found: CompletableDeferred<Stream>): WebView {
        val activity = WebViewActivityHolder.get()
        val ua = userAgent()
        val view = WebView(activity ?: context)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = ua
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? {
                val u = request.url.toString()
                if (!found.isCompleted && isMedia(u)) {
                    val headers = request.requestHeaders.orEmpty().filterKeys { it.equals("Referer", true) || it.equals("Origin", true) } +
                        ("User-Agent" to ua)
                    found.complete(Stream(u, headers, null, "sniffed"))
                }
                return null
            }

            override fun onPageFinished(v: WebView, u: String) {
                // مشغّلات كثيرة لا تطلب الفيديو قبل ضغطة تشغيل
                v.evaluateJavascript(PLAY_JS, null)
            }
        }
        (activity?.window?.decorView as? ViewGroup)?.let { decor ->
            view.layoutParams = ViewGroup.LayoutParams(1, 1)
            view.alpha = 0f
            decor.addView(view)
        }
        view.loadUrl(url, referer?.let { mapOf("Referer" to it) }.orEmpty())
        return view
    }

    companion object {
        private val MEDIA = Regex("""\.(m3u8|mp4|mpd)(\?|$)|/master\.m3u8|mime=video""", RegexOption.IGNORE_CASE)
        private val NOISE = Regex("""\.(ts|m4s|jpg|png|gif|webp|css|js|woff2?)(\?|$)|/(ads?|vast|pixel)/""", RegexOption.IGNORE_CASE)

        internal fun isMedia(url: String): Boolean = MEDIA.containsMatchIn(url) && !NOISE.containsMatchIn(url)

        private const val PLAY_JS = """(function(){
  try { if (window.jwplayer) jwplayer().play(); } catch(e) {}
  document.querySelectorAll('video').forEach(function(v){ v.muted = true; try { v.play(); } catch(e) {} });
  var b = document.querySelector('.jw-display-icon-container, .vjs-big-play-button, .plyr__control--overlaid, button[aria-label*="Play" i], .play-button, #play');
  if (b) b.click();
})();"""
    }
}
