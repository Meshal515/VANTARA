/* Weak, lifecycle-checked window ownership for remaining passive WebView tasks.
 * Explicit human verification owns its own isolated VerificationActivity. */
package eu.kanade.tachiyomi.network.interceptor

import android.app.Activity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.vantara.verification.ForegroundOwner

object WebViewActivityHolder {
    private val owner = ForegroundOwner<Activity>(
        { !it.isFinishing && !it.isDestroyed && it.window?.decorView?.isAttachedToWindow == true },
        { (it as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true },
    )

    @JvmStatic fun set(activity: Activity?) { owner.set(activity) }
    @JvmStatic fun resumed(activity: Activity) { owner.resumed(activity) }
    @JvmStatic fun paused(activity: Activity) { owner.paused(activity) }
    @JvmStatic fun clear(activity: Activity?) { owner.clear(activity) }

    @JvmStatic fun get(): Activity? = owner.get()
}
