package com.vantara.usage

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@CapacitorPlugin(name = "FollowTime")
class UsagePlugin : Plugin() {
    private val main = Handler(Looper.getMainLooper())
    private val clock = ForegroundTime(SystemClock::elapsedRealtime)
    private var owner: UsageOwner? = null
    private var wanted = false
    private var foreground = false
    private var unsaved = 0L
    private val tick = object : Runnable {
        override fun run() {
            checkpoint()
            main.postDelayed(this, 5_000)
        }
    }

    private fun checkpoint() {
        unsaved += clock.sample(wanted && foreground && owner != null)
        val current = owner ?: return
        if (unsaved > 0) {
            try {
                UsageStore.get(context).credit(current, unsaved, System.currentTimeMillis())
                unsaved = 0
            } catch (_: Exception) { /* Retry the same unsaved time at the next checkpoint. */ }
        }
    }

    override fun load() { main.post(tick) }
    override fun handleOnResume() {
        foreground = true
        checkpoint()
        notifyListeners("foreground", JSObject().put("active", true))
    }
    override fun handleOnPause() {
        foreground = false
        checkpoint()
        notifyListeners("foreground", JSObject().put("active", false))
    }
    override fun handleOnDestroy() {
        foreground = false
        checkpoint()
        main.removeCallbacks(tick)
    }

    @PluginMethod fun reader(call: PluginCall) {
        main.post {
            val user = call.getString("userId").orEmpty()
            val ref = call.getString("seriesRef").orEmpty()
            val next = if (user.isNotBlank() && ref.isNotBlank()) UsageOwner(user, "manga", ref, call.getString("title").orEmpty(), call.getString("coverUrl")) else null
            wanted = false
            checkpoint()
            if (unsaved > 0 && next != owner) { call.reject("تعذّر حفظ وقت القراءة"); return@post }
            owner = next
            wanted = call.getBoolean("active", false) == true
            checkpoint()
            call.resolve()
        }
    }

    @PluginMethod fun pending(call: PluginCall) {
        val user = call.getString("userId")?.takeIf { it.isNotBlank() } ?: return call.reject("userId مطلوب")
        try { call.resolve(JSObject().put("items", JSArray(Json.encodeToString(UsageStore.get(context).peek(user))))) }
        catch (e: Exception) { call.reject("تعذّر قراءة الوقت المحفوظ", e) }
    }

    @PluginMethod fun acknowledge(call: PluginCall) {
        val user = call.getString("userId")?.takeIf { it.isNotBlank() } ?: return call.reject("userId مطلوب")
        val ids = call.getArray("ids") ?: return call.reject("ids مطلوب")
        try {
            UsageStore.get(context).ack(user, (0 until ids.length()).map { ids.getString(it) }.toSet())
            call.resolve()
        } catch (e: Exception) { call.reject("تعذّر تأكيد الوقت", e) }
    }
}
