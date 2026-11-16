package com.vantara.notify

import android.app.ActivityManager
import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** ما يحفظه الجهاز للفحص الدوري: عنوان الخادم ورمز الإشعارات الضيق، وآخر ما عُرض. */
class NotifyStore(context: Context) {
    private val prefs = context.getSharedPreferences("vantara_notify", Context.MODE_PRIVATE)

    var endpoint: String?
        get() = prefs.getString("endpoint", null)
        set(v) = prefs.edit().putString("endpoint", v).apply()
    var token: String?
        get() = prefs.getString("token", null)
        set(v) = prefs.edit().putString("token", v).apply()

    /** «معرّف@وقت»: رسالة جديدة من نفس الشخص لها وقت جديد فتُعرض، والقديمة لا تتكرر. */
    fun shown(key: String) = prefs.getStringSet("shown", emptySet())!!.contains(key)
    fun remember(keys: Collection<String>) {
        val next = (prefs.getStringSet("shown", emptySet())!!.toList() + keys).takeLast(200).toSet()
        prefs.edit().putStringSet("shown", next).apply()
    }

    fun clear() = prefs.edit().clear().apply()
}

/**
 * الفحص الدوري (كل 15 دقيقة، أقل ما يسمح به Android) والتطبيق مغلق أو في الخلفية: يسأل الخادم
 * عن الجديد غير المعروض برمز الإشعارات وحده، ويعرضه، ويعلّمه معروضًا فلا يظهر منبثقًا مرة
 * ثانية في التطبيق. والتطبيق أمامك لا يفعل شيئًا: التطبيق نفسه يعرضه فورًا.
 */
class NotifyWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    companion object {
        private const val PERIODIC = "vantara-notify"
        private const val NOW = "vantara-notify-now"
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
        private val http by lazy {
            OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
        }

        private fun constraints() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<NotifyWorker>(15, TimeUnit.MINUTES).setConstraints(constraints()).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        /** فحص فوري (التطبيق ذهب للخلفية ووصل جديد للتو). */
        fun checkNow(context: Context) {
            // ثوانٍ قليلة: التطبيق يكون قد صار في الخلفية فعلًا، فلا يتخطى الفحص نفسه
            val request = OneTimeWorkRequestBuilder<NotifyWorker>().setConstraints(constraints()).setInitialDelay(3, TimeUnit.SECONDS).build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
            WorkManager.getInstance(context).cancelUniqueWork(NOW)
        }

        fun foreground(): Boolean {
            val state = ActivityManager.RunningAppProcessInfo()
            ActivityManager.getMyMemoryState(state)
            return state.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
        }

        fun parse(json: JSONObject): Pair<List<PhoneItem>, Boolean> {
            val list = json.optJSONArray("items") ?: JSONArray()
            val items = (0 until list.length()).mapNotNull { i ->
                val o = list.optJSONObject(i) ?: return@mapNotNull null
                val id = o.optString("id").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                PhoneItem(
                    id = id,
                    group = o.optString("group", "system"),
                    title = o.optString("title", "VANTARA"),
                    body = o.optString("body", ""),
                    image = o.optString("image").takeIf { it.isNotEmpty() && it != "null" },
                    round = o.optBoolean("round", true),
                    link = o.optString("link").takeIf { it.isNotEmpty() && it != "null" },
                    at = o.optLong("at", System.currentTimeMillis()),
                )
            }
            return items to json.optBoolean("lockPreview", false)
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val store = NotifyStore(applicationContext)
        val endpoint = store.endpoint ?: return@withContext Result.success()
        val token = store.token ?: return@withContext Result.success()
        if (foreground()) return@withContext Result.success()
        val notifier = PhoneNotifier(applicationContext)
        if (!notifier.canPost()) return@withContext Result.success()
        try {
            val pending = http.newCall(
                Request.Builder().url("$endpoint/v1/notify/pending").header("authorization", "Notify $token").get().build(),
            ).execute().use { res ->
                if (res.code == 401) {
                    // الرمز أُلغي (خروج، حذف الحساب، أو من لوحة المالك): يتوقف الفحص حتى يدخل من جديد
                    store.clear()
                    cancel(applicationContext)
                    return@withContext Result.success()
                }
                if (!res.isSuccessful) return@withContext Result.retry()
                JSONObject(res.body.string())
            }
            val (items, lockPreview) = parse(pending)
            val fresh = items.filter { !store.shown("${it.id}@${it.at}") }.sortedBy { it.at }
            val shown = notifier.post(fresh, lockPreview)
            if (shown.isNotEmpty()) {
                store.remember(shown.map { "${it.id}@${it.at}" })
                val ids = JSONArray(shown.map { it.id })
                http.newCall(
                    Request.Builder().url("$endpoint/v1/notify/seen").header("authorization", "Notify $token")
                        .post(JSONObject().put("ids", ids).toString().toRequestBody(JSON_TYPE)).build(),
                ).execute().close()
            }
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
