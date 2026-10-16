package com.vantara.addons

import android.app.Activity
import android.app.Application
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.vantara.plugins.ensureEngineInjekt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@CapacitorPlugin(name = "AddonEngine")
class AddonEnginePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var client: RemoteAddonClient
    override fun load() { ensureEngineInjekt(context.applicationContext as Application); client = nativeAddonClient(context) }
    @PluginMethod fun request(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("رابط الإضافة مطلوب")
        val id = call.getString("requestId") ?: return call.reject("معرف الطلب مطلوب")
        scope.launch {
            try { val text = client.request(url, id, call.getInt("limit") ?: 2 * 1024 * 1024, (call.getInt("timeout") ?: 15000).toLong()); call.resolve(JSObject().put("text", text)) }
            catch (_: Exception) { call.reject("تعذّر طلب الإضافة أو انتهت مهلته؛ لم يتغير مصدر الفيديو") }
        }
    }
    @PluginMethod fun cancel(call: PluginCall) { call.getString("requestId")?.let(client::cancel); call.resolve() }
    /** يفتح صفحة إعداد الإضافة داخل التطبيق؛ يرجع رابط manifest المُعدّ حين يضغط المستخدم Install. */
    @PluginMethod fun configure(call: PluginCall) {
        val url = call.getString("url")
        if (url == null || !url.startsWith("https://", ignoreCase = true)) return call.reject("إعداد الإضافة يحتاج رابط HTTPS")
        startActivityForResult(call, Intent(context, AddonConfigureActivity::class.java).putExtra(AddonConfigureActivity.EXTRA_URL, url), "configured")
    }
    @ActivityCallback private fun configured(call: PluginCall?, result: ActivityResult) {
        val manifest = result.data?.getStringExtra(AddonConfigureActivity.EXTRA_MANIFEST)
        if (result.resultCode == Activity.RESULT_OK && manifest != null) call?.resolve(JSObject().put("url", manifest))
        else call?.resolve(JSObject().put("cancelled", true))
    }
    override fun handleOnDestroy() { client.cancelPrefix(""); scope.cancel() }
}
