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

    // الكتابة (fsync) خارج الخيط الرئيسي: عليه كانت توقف زخم تمرير القارئ كل 5 ثوانٍ (UsageWriter)
    private val io = java.util.concurrent.Executors.newSingleThreadExecutor { r -> Thread(r, "vantara-follow-time").apply { isDaemon = true } }
    private val writer by lazy { UsageWriter({ o, ms, at -> UsageStore.get(context).credit(o, ms, at) }, io) }

    private fun checkpoint() {
        unsaved += clock.sample(wanted && foreground && owner != null)
        val current = owner ?: return
        if (unsaved > 0) {
            writer.write(current, unsaved, System.currentTimeMillis())
            unsaved = 0
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
        // التطبيق قد يُقتل في الخلفية: الوقت يُكتب قبل المغادرة كما كان
        writer.drain(1_000)
        notifyListeners("foreground", JSObject().put("active", false))
    }
    override fun handleOnDestroy() {
        foreground = false
        checkpoint()
        main.removeCallbacks(tick)
        writer.drain(1_000)
    }

    @PluginMethod fun reader(call: PluginCall) {
        main.post {
            val user = call.getString("userId").orEmpty()
            val ref = call.getString("seriesRef").orEmpty()
            val next = if (user.isNotBlank() && ref.isNotBlank()) UsageOwner(user, "manga", ref, call.getString("title").orEmpty(), call.getString("coverUrl")) else null
            wanted = false
            // وقت المالك السابق يدخل طابور الكتابة باسمه قبل التبديل، ويبقى له إن فشلت كتابته: لا يُنسب للجديد
            checkpoint()
            owner = next
            wanted = call.getBoolean("active", false) == true
            checkpoint()
            call.resolve()
        }
    }

    @PluginMethod fun pending(call: PluginCall) {
        val user = call.getString("userId")?.takeIf { it.isNotBlank() } ?: return call.reject("userId مطلوب")
        // خيط الإضافة لا الرئيسي: ما قبل هذا النداء (إغلاق القارئ) يُكتب أولًا، فالترتيب كما كان
        writer.drain(1_000)
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
