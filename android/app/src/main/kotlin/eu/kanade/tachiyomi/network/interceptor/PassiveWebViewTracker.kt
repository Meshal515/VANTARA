package eu.kanade.tachiyomi.network.interceptor

import android.os.SystemClock
import android.util.Log
import android.webkit.WebView
import java.util.concurrent.ConcurrentHashMap

/**
 * Reports the real lifetime of temporary network WebViews during Android Debug.
 *
 * dumpsys meminfo's "WebViews" field can still count already destroyed
 * Java instances waiting for GC. Track creation/destruction explicitly instead
 * of treating every background cover fetch as an interactive verification UI.
 *
 * Only integer object identities are retained; no WebView, URL or user data.
 */
internal object PassiveWebViewTracker {
    private const val TAG = "VantaraPassiveWebView"
    private val active = ConcurrentHashMap.newKeySet<Int>()

    fun created(view: WebView) {
        val id = System.identityHashCode(view)
        if (active.add(id)) Log.i(TAG, "START id=$id at=${SystemClock.elapsedRealtime()}")
    }

    fun destroyed(view: WebView) {
        val id = System.identityHashCode(view)
        if (active.remove(id)) Log.i(TAG, "END id=$id at=${SystemClock.elapsedRealtime()}")
    }
}
