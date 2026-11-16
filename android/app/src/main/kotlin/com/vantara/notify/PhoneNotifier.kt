package com.vantara.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.vantara.app.R
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** إشعار جاهز من الخادم (نصه بصياغة التطبيق نفسها: apps/web/lib/notifications.js). */
data class PhoneItem(
    val id: String,
    val group: String,
    val title: String,
    val body: String,
    val image: String?,
    val round: Boolean,
    val link: String?,
    val at: Long,
)

/**
 * يرسم إشعار VANTARA في الجوال: شعار VANTARA الأبيض في الشريط، بلون القسم البنفسجي، وصورة
 * المرسل دائرية أو غلاف العمل بزوايا ناعمة، وقناة لكل نوع (يطفئها المستخدم من إعدادات الجوال
 * أيضًا). شاشة القفل: المحتوى مخفي إلا إن سمح صاحبه («إظهار المحتوى على شاشة القفل»).
 */
class PhoneNotifier(private val context: Context) {

    companion object {
        const val BRAND = 0xFF8F5CFF.toInt()
        private const val TAG = "vantara"
        private val CHANNELS = listOf(
            Triple("messages", "رسائل المجلس", NotificationManager.IMPORTANCE_HIGH),
            Triple("favorites", "جديد المفضلة", NotificationManager.IMPORTANCE_DEFAULT),
            Triple("social", "الترشيحات والدعوات", NotificationManager.IMPORTANCE_DEFAULT),
            Triple("system", "أحداث VANTARA", NotificationManager.IMPORTANCE_LOW),
        )
        private val LOCKED_TEXT = mapOf(
            "messages" to "رسالة جديدة",
            "favorites" to "جديد في مفضلتك",
            "social" to "عندك جديد من أصدقائك",
            "system" to "إشعار جديد",
        )

        /** رقم ثابت لكل إشعار: رسالة جديدة من نفس الشخص تحدّث إشعاره لا تكرّره. */
        fun numberOf(id: String): Int = id.hashCode() and 0x7fffffff
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    fun ensureChannels() {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        for ((id, name, importance) in CHANNELS) {
            if (manager.getNotificationChannel(id) != null) continue
            manager.createNotificationChannel(NotificationChannel(id, name, importance).apply {
                enableLights(true)
                lightColor = BRAND
                lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
            })
        }
    }

    fun canPost(): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

    /** يعرض الإشعارات؛ يرجع ما عُرض فعلًا (ليُعلَّم «معروضًا» في الخادم). */
    fun post(items: List<PhoneItem>, lockPreview: Boolean): List<PhoneItem> {
        if (items.isEmpty() || !canPost()) return emptyList()
        ensureChannels()
        val manager = NotificationManagerCompat.from(context)
        val shown = mutableListOf<PhoneItem>()
        for (item in items) {
            val channel = if (CHANNELS.any { it.first == item.group }) item.group else "system"
            val builder = NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_stat_vantara)
                .setColor(BRAND)
                .setContentTitle(item.title)
                .setContentText(item.body.ifBlank { null })
                .setStyle(NotificationCompat.BigTextStyle().bigText(item.body))
                .setWhen(item.at)
                .setShowWhen(true)
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
                .setGroup("vantara.$channel")
                .setCategory(if (channel == "messages") NotificationCompat.CATEGORY_MESSAGE else NotificationCompat.CATEGORY_SOCIAL)
                .setContentIntent(openIntent(item))
            artFor(item)?.let { builder.setLargeIcon(it) }
            if (!lockPreview) {
                builder.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                builder.setPublicVersion(
                    NotificationCompat.Builder(context, channel)
                        .setSmallIcon(R.drawable.ic_stat_vantara)
                        .setColor(BRAND)
                        .setContentTitle("VANTARA")
                        .setContentText(LOCKED_TEXT[channel] ?: "إشعار جديد")
                        .build(),
                )
            } else builder.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            try {
                manager.notify(TAG, numberOf(item.id), builder.build())
                shown += item
            } catch (_: SecurityException) {
                // الإذن سُحب بين الفحص والعرض: لا يُعلَّم معروضًا، فيصل في التطبيق
                return shown
            }
        }
        summarize(manager, shown)
        return shown
    }

    /** إشعاران أو أكثر في قناة: ملخص واحد يجمعهم (التجميع الذي طلبه المالك). */
    private fun summarize(manager: NotificationManagerCompat, shown: List<PhoneItem>) {
        for ((channel, items) in shown.groupBy { if (CHANNELS.any { c -> c.first == it.group }) it.group else "system" }) {
            if (items.size < 2) continue
            val style = NotificationCompat.InboxStyle()
            items.take(6).forEach { style.addLine("${it.title} — ${it.body}") }
            val summary = NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_stat_vantara)
                .setColor(BRAND)
                .setContentTitle("VANTARA")
                .setContentText(LOCKED_TEXT[channel] ?: "إشعار جديد")
                .setStyle(style)
                .setGroup("vantara.$channel")
                .setGroupSummary(true)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .build()
            try {
                manager.notify(TAG, numberOf("summary:$channel"), summary)
            } catch (_: SecurityException) {
            }
        }
    }

    fun cancelAll() {
        NotificationManagerCompat.from(context).cancelAll()
    }

    /** الضغط يفتح المكان نفسه داخل التطبيق (رابط vantara://) ويعلّم الإشعار مقروءًا. */
    private fun openIntent(item: PhoneItem): PendingIntent {
        val link = (item.link ?: "vantara://notifications").let {
            Uri.parse(it).buildUpon().appendQueryParameter("n", item.id).build()
        }
        val intent = Intent(Intent.ACTION_VIEW, link).apply {
            setPackage(context.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        return PendingIntent.getActivity(
            context,
            numberOf(item.id),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    /** صورة الإشعار: تُحمَّل بمهلة قصيرة وحجم محدود، وفشلها لا يمنع الإشعار. */
    private fun artFor(item: PhoneItem): Bitmap? {
        val src = item.image?.takeIf { it.startsWith("https://") } ?: return null
        return try {
            http.newCall(Request.Builder().url(src).build()).execute().use { res ->
                if (!res.isSuccessful) return null
                val bytes = res.body.bytes()
                if (bytes.size > 3_000_000) return null
                val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
                var sample = 1
                while (opts.outWidth / (sample * 2) >= 192 && opts.outHeight / (sample * 2) >= 192) sample *= 2
                val raw = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                    ?: return null
                shape(raw, item.round)
            }
        } catch (_: Exception) {
            null
        }
    }

    /** مربع 192 مقصوص من الوسط: دائرة للأشخاص، وزوايا ناعمة لأغلفة الأعمال. */
    private fun shape(src: Bitmap, round: Boolean): Bitmap {
        val size = 192
        val side = minOf(src.width, src.height)
        // الغلاف الطولي يُقص من أعلاه (الوجوه والعنوان) لا من وسطه
        val top = if (round) (src.height - side) / 2 else 0
        val left = (src.width - side) / 2
        val square = Bitmap.createBitmap(src, left, top, side, side)
        val scaled = Bitmap.createScaledBitmap(square, size, size, true)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        val canvas = Canvas(out)
        if (round) canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
        else canvas.drawRoundRect(RectF(0f, 0f, size.toFloat(), size.toFloat()), 28f, 28f, paint)
        return out
    }
}
