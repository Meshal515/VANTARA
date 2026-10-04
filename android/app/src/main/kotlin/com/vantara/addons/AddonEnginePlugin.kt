package com.vantara.addons

import android.app.Application
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
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
    override fun handleOnDestroy() { client.cancelPrefix(""); scope.cancel() }
}
