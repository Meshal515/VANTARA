package com.vantara.runtime

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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * VANTARA's hidden browser behind CloudStream's WebViewResolver: the page loads as a phone would (its scripts build
 * the player and request the stream), and every request it makes is matched against the provider's pattern. The first
 * match ends the visit, as in CloudStream.
 *
 * Built like the engine's own sniffer (com.vantara.anime.hosts.WebViewSniffer): full size behind the app's content
 * and fully transparent (many players do nothing in a 1×1 window), requests seen both from the network hook and from
 * the page's own resource list (hls.js requests that skip the hook). A provider's page cannot reach the device: only
 * HTTP(S) navigation, no file or content access, no new windows, no JavaScript interface.
 */
internal class HiddenPageBrowser(private val context: Context) : RuntimeBrowser.Engine {
    private val main = Handler(Looper.getMainLooper())

    override fun open(job: RuntimeBrowser.Job): RuntimeBrowser.Result? {
        if (Looper.myLooper() == Looper.getMainLooper()) return null
        // A queue no longer than a few seconds: the server's own link budget keeps running meanwhile
        if (!slots.tryAcquire(SLOT_WAIT_MS.coerceAtMost(job.timeoutMs), TimeUnit.MILLISECONDS)) return null
        try { return visit(job) } finally { slots.release() }
    }

    private class Visit(val job: RuntimeBrowser.Job) {
        val done = CountDownLatch(1)
        val active = AtomicBoolean(true)
        val view = AtomicReference<WebView?>(null)
        private val lock = Any()
        private val seen = LinkedHashMap<String, RuntimeBrowser.Seen>()
        private val extra = LinkedHashMap<String, RuntimeBrowser.Seen>()
        private val scripts = ArrayList<String>()
        @Volatile var intercepted: RuntimeBrowser.Seen? = null

        fun observe(url: String, method: String, headers: Map<String, String>) {
            if (!active.get() || !(url.startsWith("https://") || url.startsWith("http://"))) return
            val request = RuntimeBrowser.Seen(url, method, withAgent(headers))
            synchronized(lock) {
                if (seen.size < MAX_SEEN && url !in seen) seen[url] = request
                if (job.extra.any { RuntimeBrowser.matches(it, url) } && extra.size < MAX_EXTRA && url !in extra) extra[url] = request
            }
            val pattern = job.intercept ?: return
            if (intercepted == null && RuntimeBrowser.matches(pattern, url)) { intercepted = request; done.countDown() }
        }
        fun script(value: String?) {
            if (value.isNullOrEmpty() || value == "null") return
            synchronized(lock) { if (scripts.size < 4) scripts += value }
        }
        // The CDN may bind a stream to the browser that asked: the User-Agent the page used goes with the request
        private fun withAgent(headers: Map<String, String>) =
            if (headers.keys.any { it.equals("User-Agent", true) }) headers else headers + ("User-Agent" to job.userAgent)
        fun result() = synchronized(lock) {
            RuntimeBrowser.Result(intercepted, extra.values.toList(), seen.values.toList(), scripts.toList())
        }
    }

    private fun visit(job: RuntimeBrowser.Job): RuntimeBrowser.Result {
        val visit = Visit(job)
        main.post { if (visit.active.get()) runCatching { visit.view.set(load(visit)) }.onFailure { visit.done.countDown() } }
        try { visit.done.await(job.timeoutMs, TimeUnit.MILLISECONDS) }
        catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        visit.active.set(false)
        main.post {
            visit.view.getAndSet(null)?.let { v ->
                (v.parent as? ViewGroup)?.removeView(v)
                runCatching { v.stopLoading() }
                runCatching { v.destroy() }
            }
        }
        return visit.result()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun load(visit: Visit): WebView {
        val job = visit.job
        val activity = WebViewActivityHolder.get()
        val view = WebView(activity ?: context)
        @Suppress("DEPRECATION")
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = job.userAgent
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme?.lowercase()
                return scheme != "https" && scheme != "http"
            }
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? {
                visit.observe(request.url.toString(), request.method ?: "GET", request.requestHeaders.orEmpty())
                return null
            }
            override fun onPageFinished(v: WebView, url: String) {
                if (!visit.active.get()) return
                job.script?.let { code -> v.evaluateJavascript(code) { visit.script(it) } }
                v.evaluateJavascript(PLAY_JS, null)
            }
        }
        // Every second: what the page knows it requested (hls.js, <video>, jwplayer), then a nudge to play
        val poll = object : Runnable {
            var ticks = 0
            override fun run() {
                if (!visit.active.get()) return
                ticks++
                view.evaluateJavascript(SCAN_JS) { raw ->
                    // evaluateJavascript answers with the JSON encoding of the string JSON.stringify returned
                    val list = runCatching { org.json.JSONArray(org.json.JSONTokener(raw).nextValue() as String) }
                        .getOrNull() ?: return@evaluateJavascript
                    for (i in 0 until list.length()) list.optString(i).takeIf { it.isNotEmpty() }?.let { visit.observe(it, "GET", emptyMap()) }
                }
                if (ticks % 3 == 0) view.evaluateJavascript(PLAY_JS, null)
                main.postDelayed(this, 1000)
            }
        }
        (activity?.window?.decorView as? ViewGroup)?.let { decor ->
            view.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            view.alpha = 0f
            // Behind the app's content: never seen and never touched
            decor.addView(view, 0)
        }
        val headers = LinkedHashMap(job.headers)
        job.referer?.let { headers["Referer"] = it }
        view.loadUrl(job.url, headers)
        main.postDelayed(poll, 1500)
        return view
    }

    companion object {
        /** Two pages at once on a phone, across every source. */
        private val slots = Semaphore(2, true)
        private const val SLOT_WAIT_MS = 8_000L
        private const val MAX_SEEN = 300
        private const val MAX_EXTRA = 64

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
