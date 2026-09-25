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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive

/**
 * متصفح مخفي يفتح صفحة سيرفر كما يفتحها متصفح، آخر حل بعد [Generic]. يلتقط
 * الرابط من ثلاث جهات، أيها أسبق:
 *  1. طلبات الشبكة ([WebViewClient.shouldInterceptRequest]).
 *  2. الصفحة نفسها كل ثانية: `performance` (يرى طلبات hls.js وعناصر الفيديو
 *     التي لا تمر أحيانًا باعتراض الطلبات)، `<video>`، قائمة jwplayer.
 *  3. HTML الصفحة بعد تنفيذ سكربتاتها، عبر [Generic].
 *
 * بحجم الشاشة خلف واجهة التطبيق وبشفافية كاملة: مشغّلات كثيرة لا تعمل في
 * نافذة 1×1. الكوكيز التي يضعها المشغّل تصل Media3 تلقائيًا: جرّة كوكيز OkHttp
 * هي [android.webkit.CookieManager] نفسه.
 */
class WebViewSniffer(
    private val context: Context,
    private val userAgent: () -> String,
    private val timeoutMs: Long = 25_000,
) : Sniffer {

    private val main = Handler(Looper.getMainLooper())
    private val json = Json { ignoreUnknownKeys = true }

    /** حلقة بستة سيرفرات لا تفتح ستة متصفحات معًا على جوال. */
    private val slots = Semaphore(2)

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
        fun take(u: String, pageUrl: String?) {
            if (found.isCompleted || !isMedia(u)) return
            val origin = pageUrl?.let { runCatching { java.net.URI(it) }.getOrNull() }?.let { "${it.scheme}://${it.host}" }
            val headers = buildMap {
                put("User-Agent", ua)
                origin?.let { put("Referer", "$it/"); put("Origin", it) }
            }
            found.complete(Stream(u, headers, null, "sniffed"))
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? {
                val u = request.url.toString()
                if (!found.isCompleted && isMedia(u)) {
                    val ref = request.requestHeaders.orEmpty().entries.firstOrNull { it.key.equals("Referer", true) }?.value
                    take(u, ref ?: url)
                }
                return null
            }

            override fun onPageFinished(v: WebView, u: String) {
                v.evaluateJavascript(PLAY_JS, null)
                v.evaluateJavascript("document.documentElement.outerHTML") { raw ->
                    val html = runCatching { json.parseToJsonElement(raw).jsonPrimitive.content }.getOrNull() ?: return@evaluateJavascript
                    Generic.streams(html, u).firstOrNull()?.let { take(it, u) }
                }
            }
        }
        // كل ثانية: ما تعرفه الصفحة عن فيديوهاتها، ثم محاولة تشغيل
        val poll = object : Runnable {
            var ticks = 0
            override fun run() {
                if (found.isCompleted || ticks++ > (timeoutMs / 1000).toInt()) return
                view.evaluateJavascript(SCAN_JS) { raw ->
                    val list = runCatching { json.parseToJsonElement(json.parseToJsonElement(raw).jsonPrimitive.content).jsonArray.map { it.jsonPrimitive.content } }.getOrNull()
                    list?.firstOrNull(::isMedia)?.let { take(it, view.url) }
                }
                if (ticks % 3 == 0) view.evaluateJavascript(PLAY_JS, null)
                main.postDelayed(this, 1000)
            }
        }
        (activity?.window?.decorView as? ViewGroup)?.let { decor ->
            view.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            view.alpha = 0f
            // خلف محتوى التطبيق: لا يراه المستخدم ولا يلتقط لمساته
            decor.addView(view, 0)
        }
        view.loadUrl(url, referer?.let { mapOf("Referer" to it) }.orEmpty())
        main.postDelayed(poll, 1500)
        return view
    }

    companion object {
        private val MEDIA = Regex("""\.(m3u8|mp4|mpd)(\?|$)|/master\.m3u8|mime=video|/videoplayback\?""", RegexOption.IGNORE_CASE)
        private val NOISE = Regex("""\.(ts|m4s|jpg|png|gif|webp|css|js|woff2?)(\?|$)|/(ads?|vast|pixel|preroll)/|^blob:|^data:""", RegexOption.IGNORE_CASE)

        internal fun isMedia(url: String): Boolean = url.startsWith("http") && MEDIA.containsMatchIn(url) && !NOISE.containsMatchIn(url)

        private const val PLAY_JS = """(function(){
  try { if (window.jwplayer) jwplayer().play(); } catch(e) {}
  document.querySelectorAll('video').forEach(function(v){ v.muted = true; try { v.play(); } catch(e) {} });
  var b = document.querySelector('.jw-display-icon-container, .vjs-big-play-button, .plyr__control--overlaid, button[aria-label*="Play" i], .play-button, #play, .play');
  if (b) b.click();
})();"""

        private const val SCAN_JS = """(function(){
  var u = [];
  try { performance.getEntriesByType('resource').forEach(function(e){ u.push(e.name); }); } catch(e) {}
  document.querySelectorAll('video, source').forEach(function(v){ if (v.currentSrc) u.push(v.currentSrc); if (v.src) u.push(v.src); });
  try { if (window.jwplayer) { var p = jwplayer().getPlaylistItem(); if (p) { if (p.file) u.push(p.file); (p.sources || []).forEach(function(s){ if (s.file) u.push(s.file); }); } } } catch(e) {}
  return JSON.stringify(u.slice(-80));
})()"""
    }
}
