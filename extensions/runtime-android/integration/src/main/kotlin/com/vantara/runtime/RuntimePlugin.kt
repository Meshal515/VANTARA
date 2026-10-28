package com.vantara.runtime

import android.app.Application
import android.app.Activity
import android.content.Intent
import android.webkit.WebSettings
import androidx.activity.result.ActivityResult
import com.getcapacitor.*
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.vantara.anime.AnimeEngine
import com.vantara.plugins.ensureEngineInjekt
import dev.vantara.runtime.android.AndroidRuntimeClient
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import com.vantara.verification.*

/** Registered by the Debug-only bootstrap before Capacitor builds its bridge. */
@CapacitorPlugin(name="VantaraRuntime")
class RuntimePlugin : Plugin() {
    private val jobs=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    private lateinit var host: RuntimeHost
    private var foreground=false
    private var active: VerificationPending?=null
    override fun load() {
        try {
            ensureEngineInjekt(context.applicationContext as Application)
            val engine=AnimeEngine.get(context);engine.setRuntimeSources(emptyList())
            host=RuntimeHost(context,engine,WebSettings.getDefaultUserAgent(context))
        }catch(error:Exception){android.util.Log.w("VantaraRuntime","RUNTIME_INITIALIZATION_FAILED:"+error.javaClass.simpleName)}
    }
    private fun run(call: PluginCall,action: suspend ()->JsonElement) { jobs.launch {
        try { check(::host.isInitialized) { "RUNTIME_INITIALIZATION_FAILED" };call.resolve(JSObject(action().toString())) }
        catch(error: CancellationException) { call.reject("ألغي طلب الإضافة","OPERATION_CANCELLED") }
        catch(error: Exception) {
            val code=error.message?.takeIf { it.matches(Regex("[A-Z][A-Z0-9_]{1,100}")) } ?: "RUNTIME_OPERATION_FAILED"
            android.util.Log.w("VantaraRuntime",code+":"+error.javaClass.simpleName)
            call.reject("تعذر تنفيذ عملية الإضافة: $code",code)
        }
    } }
    @PluginMethod fun capabilities(call: PluginCall) { call.resolve(JSObject().put("cloudstream",::host.isInitialized && AndroidRuntimeClient.supportedOnThisPlatform()).put("profile","cloudstream-original-v1").put("experimental",true).put("platform","android")) }
    @PluginMethod fun setProfile(call: PluginCall)=run(call) { host.setProfile(call.getString("profile") ?: error("PROFILE_REQUIRED"));buildJsonObject { put("ok",true) } }
    @PluginMethod fun list(call: PluginCall)=run(call) { host.list() }
    @PluginMethod fun addRepository(call: PluginCall)=run(call) { host.addRepository(call.getString("url") ?: error("REPOSITORY_REQUIRED")) }
    @PluginMethod fun removeRepository(call: PluginCall)=run(call) { host.removeRepository(call.getString("url") ?: error("REPOSITORY_REQUIRED"));buildJsonObject { put("ok",true) } }
    @PluginMethod fun extensions(call: PluginCall)=run(call) { buildJsonObject { put("extensions",host.extensions(call.getString("url") ?: error("REPOSITORY_REQUIRED"))) } }
    @PluginMethod fun install(call: PluginCall)=run(call) { host.install(call.getString("url") ?: error("REPOSITORY_REQUIRED"),call.getString("pkg") ?: error("PACKAGE_REQUIRED"),call.getString("content") ?: "anime") }
    @PluginMethod fun uninstall(call: PluginCall)=run(call) { host.uninstall(call.getString("pkg") ?: error("PACKAGE_REQUIRED"));buildJsonObject { put("ok",true) } }
    @PluginMethod fun enable(call: PluginCall)=run(call) { host.enable(call.getString("pkg") ?: error("PACKAGE_REQUIRED"),call.getBoolean("enabled") ?: error("ENABLED_REQUIRED"));buildJsonObject { put("ok",true) } }
    @PluginMethod fun verificationPending(call: PluginCall)=run(call) { buildJsonObject { put("hosts",JsonArray(host.verificationHosts().map(::JsonPrimitive))) } }
    /** Explicit manager button only. No repository load/background path calls this method. */
    @PluginMethod fun verify(call: PluginCall) { activity.runOnUiThread {
        if(!foreground || activity.isFinishing || activity.isDestroyed || active!=null) { call.reject("افتح التحقق من الشاشة الحالية","VERIFICATION_BUSY");return@runOnUiThread }
        try {
            val item=host.beginVerification(call.getString("host") ?: error("HOST_REQUIRED"));active=item
            startActivityForResult(call,Intent(context,VerificationActivity::class.java)
                .putExtra("host",item.host).putExtra("origin",item.origin).putExtra("url",item.url)
                .putExtra("userAgent",item.userAgent).putExtra("sourceName",item.sourceName).putExtra("token",item.token),"verified")
        }catch(_:Exception){ active?.let { VerificationCoordinator.finish(it.host,it.token,"failed","launch_failed") };active=null;call.reject("تعذر فتح التحقق","VERIFICATION_LAUNCH_FAILED") }
    } }
    @ActivityCallback private fun verified(call: PluginCall?,result: ActivityResult) {
        val item=active;active=null
        if(call==null || item==null)return
        val data=result.data
        val matches=data?.getStringExtra("host")==item.host && data?.getStringExtra("token")==item.token
        val value=if(matches && result.resultCode==Activity.RESULT_OK && data?.getStringExtra("state")=="verified")
            data.getStringExtra("clearance")?.let { VerificationPolicy.clearance("cf_clearance=$it") } else null
        if(value==null) {
            VerificationCoordinator.finish(item.host,item.token,"cancelled",if(matches)data?.getStringExtra("reason") else "interrupted")
            call.resolve(JSObject().put("host",item.host).put("state","cancelled"));return
        }
        run(call) {
            try { host.completeVerification(item,value).also { VerificationCoordinator.finish(item.host,item.token,"verified") } }
            catch(error:Exception) { VerificationCoordinator.finish(item.host,item.token,"failed","source_retry_failed");throw error }
        }
    }
    override fun handleOnResume() { foreground=true }
    override fun handleOnPause() { foreground=false }
    override fun handleOnDestroy() { jobs.cancel();if(::host.isInitialized)host.close() }
}
