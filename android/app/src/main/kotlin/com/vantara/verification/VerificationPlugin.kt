package com.vantara.verification

import android.app.Activity
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "Verification")
class VerificationPlugin : Plugin() {
    private val main = Handler(Looper.getMainLooper())
    private var foreground = false
    private var active: VerificationPending? = null
    private val retained = linkedMapOf<String, Pair<String, JSObject>>()

    private val reportChallenge: (okhttp3.HttpUrl, String) -> Unit = { url, userAgent ->
        VerificationCoordinator.require(url, userAgent)
        Unit
    }
    override fun load() {
        eu.kanade.tachiyomi.network.interceptor.SourceVerificationRequests.reporter = reportChallenge
        VerificationCoordinator.attach(this) { item, state, reason -> main.post { emit(item, state, reason) } }
        VerificationCoordinator.pending().forEach { emit(it, it.state, null) }
    }
    override fun handleOnResume() { foreground = true }
    override fun handleOnPause() { foreground = false }
    override fun handleOnDestroy() {
        if (eu.kanade.tachiyomi.network.interceptor.SourceVerificationRequests.reporter === reportChallenge)
            eu.kanade.tachiyomi.network.interceptor.SourceVerificationRequests.reporter = null
        VerificationCoordinator.detach(this)
    }

    private fun json(item: VerificationPending, state: String = item.state, reason: String? = null): JSObject = JSObject()
        .put("host", item.host).put("origin", item.origin).put("sourceName", item.sourceName)
        .put("kind", item.kind).put("token", item.token).put("state", state)
        .apply { if (reason != null) put("reason", reason) }

    private fun emit(item: VerificationPending, state: String, reason: String?) {
        val data = json(item, state, reason)
        val event = if (state == "required") "required" else "state"
        retained.remove(if (state == "required") "state:${item.host}" else "required:${item.host}")
        if (hasListeners(event)) notifyListeners(event, data)
        else {
            // Capacitor's default retained event list is unbounded. Keep only
            // the latest event per host, and at most sixteen host/event pairs.
            retained["$event:${item.host}"] = event to data
            while (retained.size > 16) retained.remove(retained.keys.first())
        }
    }

    @PluginMethod(returnType = PluginMethod.RETURN_NONE)
    override fun addListener(call: PluginCall) { main.post {
        super.addListener(call)
        val event = call.getString("eventName")
        retained.filterValues { it.first == event }.toMap().forEach { (key, value) ->
            retained.remove(key)
            notifyListeners(value.first, value.second)
        }
    } }

    @PluginMethod fun pending(call: PluginCall) {
        val list = JSArray()
        VerificationCoordinator.pending().forEach { list.put(json(it)) }
        call.resolve(JSObject().put("pending", list))
    }

    /** Called only by the visible verification button; never by interceptors. */
    @PluginMethod fun begin(call: PluginCall) { main.post {
        val host = call.getString("host") ?: return@post call.reject("المضيف مطلوب")
        if (!foreground || activity == null || activity.isFinishing || activity.isDestroyed) return@post call.reject("افتح التحقق من الشاشة الحالية")
        val item = VerificationCoordinator.begin(host) ?: return@post call.reject("التحقق غير متاح أو توجد جلسة مفتوحة")
        active = item
        try {
            startActivityForResult(call, Intent(context, VerificationActivity::class.java)
                .putExtra("host", item.host).putExtra("origin", item.origin).putExtra("url", item.url)
                .putExtra("userAgent", item.userAgent).putExtra("sourceName", item.sourceName)
                // An anime source or video host reaches its site through the engine's network (encrypted DNS first,
                // split ClientHello). The check page took the system network instead and failed in seconds on a
                // blocked site; it now goes through the same path (VerificationTunnel), as CloudStream checks do.
                .putExtra("engineNetwork", com.vantara.anime.net.AnimeHostRouter.prefersDoh(item.host))
                .putExtra("token", item.token), "verified")
        } catch (_: Exception) {
            active = null
            VerificationCoordinator.finish(item.host, item.token, "failed", "launch_failed")
            call.resolve(json(item, "failed", "launch_failed"))
        }
    } }

    @ActivityCallback private fun verified(call: PluginCall?, result: ActivityResult) { main.post {
        val item = active ?: VerificationCoordinator.pending().firstOrNull { it.state == "active" }
        active = null
        if (item == null) { call?.resolve(JSObject().put("state", "cancelled")); return@post }
        if (VerificationCoordinator.pending().none { it.host == item.host && it.token == item.token && it.state == "active" }) {
            call?.resolve(json(item, "expired", "timeout")); return@post
        }
        val data = result.data
        val matches = data?.getStringExtra("host") == item.host && data?.getStringExtra("token") == item.token
        val state = if (matches) data?.getStringExtra("state") else "cancelled"
        val verified = matches && state == "verified" && result.resultCode == Activity.RESULT_OK
        val value = if (verified) data?.getStringExtra("clearance")?.let { VerificationPolicy.clearance("cf_clearance=$it") } else null
        // كل كوكيز الموقع من متصفح التحقق (لا cf_clearance وحده)، والقيم محصورة في VerificationPolicy.cookiePairs
        val pairs = if (verified) VerificationPolicy.cookiePairs(data?.getStringExtra("cookies")).filter { it.first != "cf_clearance" } else emptyList()
        fun finish(state: String, reason: String?) {
            VerificationCoordinator.finish(item.host, item.token, state, reason)
            call?.resolve(json(item, state, reason))
        }
        if (!verified) {
            finish(if (state == "cancelled" || !matches) "cancelled" else "failed", if (matches) data?.getStringExtra("reason") else "interrupted")
            return@post
        }
        // صفحة فتحت بلا تحدٍّ ولا كوكي تنقله: لا شيء يُحفظ، والمصدر يُعاد طلبه كما هو
        if (value == null && pairs.isEmpty()) { finish("verified", null); return@post }
        // HTTPS فقط. cf_clearance بلا Max-Age قصير مفروض: كان 1800 ث يُرجع التحقق بعد نصف ساعة ولو كان الموقع
        // أعطاه مدة أطول. الخادم يقرر صلاحيته؛ إن رفضه يظهر التحدي ويُحل كما الآن. بقية الكوكيز بالمدة نفسها.
        val jar = try { CookieManager.getInstance() } catch (_: RuntimeException) { return@post finish("failed", "cookie_store_unavailable") }
        val all = (listOfNotNull(value?.let { "cf_clearance" to it }) + pairs)
        var left = all.size
        var ok = false
        for ((name, v) in all) {
            try {
                jar.setCookie(item.origin + "/", "$name=$v; Path=/; Max-Age=2592000; Secure; SameSite=Lax") { accepted ->
                    if (accepted) ok = true
                    if (--left == 0) {
                        try { jar.flush() } catch (_: RuntimeException) {}
                        if (ok) finish("verified", null) else finish("failed", "cookie_rejected")
                    }
                }
            } catch (_: RuntimeException) { if (--left == 0) finish(if (ok) "verified" else "failed", if (ok) null else "cookie_store_unavailable") }
        }
    } }
}
