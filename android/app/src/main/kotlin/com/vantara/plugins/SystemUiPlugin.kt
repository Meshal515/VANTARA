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
