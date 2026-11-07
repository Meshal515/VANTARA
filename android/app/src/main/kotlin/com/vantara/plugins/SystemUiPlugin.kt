package com.vantara.plugins

import android.provider.Settings
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * ملء الشاشة للقارئ.
 *
 * الـWebView لا يستطيع إخفاء شريطي الحالة والتنقّل وحده، والقارئ بلاهما
 * «ملء شاشة» بالاسم فقط. عند القراءة: الشريطان مخفيّان (سحبة من الحافة
 * تُظهرهما مؤقتًا) والشاشة لا تنطفئ وسط الفصل. وعند الخروج يرجع كل شيء.
 */
@CapacitorPlugin(name = "SystemUi")
class SystemUiPlugin : Plugin() {

    /** The sole local preference, shared with native playback UI. Stable is denied in Kotlin. */
    @PluginMethod
    fun diagnostics(call: PluginCall) {
        val requested = call.getBoolean("visible")
        if (requested != null && !com.vantara.app.BuildConfig.DEBUG) {
            call.reject("Diagnostics are available in Debug builds only", "DEBUG_ONLY")
            return
        }
        if (requested != null) DiagnosticVisibility.set(context, requested)
        val visible = DiagnosticVisibility.visible(context)
        if (requested != null) { if (visible) MainThreadWatch.start() else MainThreadWatch.stop() }
        call.resolve(JSObject().put("debug", com.vantara.app.BuildConfig.DEBUG).put("visible", visible))
    }

    // رصد الخيط الرئيسي (MainThreadWatch): يعمل مع «إظهار التشخيص» في Debug فقط، من الإقلاع
    override fun load() {
        if (DiagnosticVisibility.visible(context)) MainThreadWatch.start()
    }

    /** الرسائل الطويلة على الخيط الرئيسي مؤخرًا، لتقرير وقفات القارئ. Debug فقط. */
    @PluginMethod
    fun mainThreadStalls(call: PluginCall) {
        if (!com.vantara.app.BuildConfig.DEBUG) return call.reject("Diagnostics are available in Debug builds only", "DEBUG_ONLY")
        val list = com.getcapacitor.JSArray()
        for ((ago, block) in MainThreadWatch.recent()) {
            list.put(JSObject().put("agoMs", ago).put("ms", block.ms).put("what", block.what).put("stack", com.getcapacitor.JSArray(block.stack)))
        }
        call.resolve(JSObject().put("blocks", list))
    }

    /**
     * معرّف أندرويد الثابت لنفس (مفتاح توقيع التطبيق + المستخدم + الجهاز).
     *
     * لا يُستعمل كسرّ؛ هو فقط مفتاح الاسترجاع بعد حذف التطبيق. الاعتماد الأول
     * يبقى يدويًا، والإلغاء الصريح في الخادم لا يُعاد فتحه بهذا المعرّف.
     */
    @PluginMethod
    fun deviceId(call: PluginCall) {
        val currentActivity = activity ?: return call.reject("no activity")
        val identifier = Settings.Secure.getString(
            currentActivity.contentResolver,
            Settings.Secure.ANDROID_ID,
        )?.trim()?.lowercase()
        if (identifier.isNullOrBlank()) return call.reject("android id unavailable")

        val ret = JSObject()
        ret.put("identifier", identifier)
        call.resolve(ret)
    }

    @PluginMethod
    fun immersive(call: PluginCall) {
        val on = call.getBoolean("on", false) ?: false
        val activity = activity ?: return call.reject("no activity")
        activity.runOnUiThread {
            val window = activity.window
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            if (on) {
                controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(WindowInsetsCompat.Type.systemBars())
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars())
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            call.resolve()
        }
    }
}
