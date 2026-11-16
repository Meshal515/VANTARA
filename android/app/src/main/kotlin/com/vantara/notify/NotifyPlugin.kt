package com.vantara.notify

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * جسر إشعارات الجوال للواجهة.
 *
 *   configure({ endpoint, token })  الواجهة أخذت رمز الإشعارات من الخادم: يُحفظ ويبدأ الفحص الدوري.
 *   clear()                         خروج أو إطفاء: يُلغى الرمز في الخادم ويتوقف الفحص وتُمسح الإشعارات.
 *   checkNow()                      فحص فوري (التطبيق ذهب للخلفية ووصل جديد).
 *   status()                        { configured, permission, enabled }
 *   requestPermission()             إذن Android 13+ لعرض الإشعارات.
 *   openSettings()                  إعدادات إشعارات VANTARA في النظام (القنوات).
 */
@CapacitorPlugin(name = "PhoneNotify")
class NotifyPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun permitted(): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    @PluginMethod
    fun configure(call: PluginCall) {
        val endpoint = call.getString("endpoint")?.trimEnd('/')
        val token = call.getString("token")
        if (endpoint.isNullOrBlank() || !endpoint.startsWith("https://") || token.isNullOrBlank() || !token.startsWith("vn_")) {
            call.reject("bad_config")
            return
        }
        val store = NotifyStore(context)
        store.endpoint = endpoint
        store.token = token
        PhoneNotifier(context).ensureChannels()
        NotifyWorker.schedule(context)
        call.resolve(JSObject().put("permission", permitted()))
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        val store = NotifyStore(context)
        val endpoint = store.endpoint
        val token = store.token
        store.clear()
        NotifyWorker.cancel(context)
        PhoneNotifier(context).cancelAll()
        if (endpoint != null && token != null) {
            scope.launch {
                try {
                    OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).build()
                        .newCall(Request.Builder().url("$endpoint/v1/notify/device").header("authorization", "Notify $token").delete().build())
                        .execute().close()
                } catch (_: Exception) {
                    // الخادم يُسقط الرموز القديمة فوق السقف، وحذف الحساب يُسقطها كلها
                }
            }
        }
        call.resolve()
    }

    @PluginMethod
    fun checkNow(call: PluginCall) {
        if (NotifyStore(context).token != null) NotifyWorker.checkNow(context)
        call.resolve()
    }

    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("configured", NotifyStore(context).token != null)
                .put("permission", permitted())
                .put("enabled", PhoneNotifier(context).canPost()),
        )
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (!permitted()) activity?.let { ActivityCompat.requestPermissions(it, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7311) }
        call.resolve(JSObject().put("permission", permitted()))
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }
}
