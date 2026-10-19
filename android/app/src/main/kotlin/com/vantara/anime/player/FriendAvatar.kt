package com.vantara.anime.player

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.Executors

/** Cancels network work when a sheet closes; initials remain until a real face loads. */
class FriendAvatar(context: Context, private val client: OkHttpClient, private val url: String?, name: String) : FrameLayout(context) {
    private var call: Call? = null
    private var generation = 0
    private val face = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
    init {
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Tone.SURFACE_3) }
        clipToOutline = true
        addView(TextView(context).apply { text = name.take(1); textSize = 15f; gravity = Gravity.CENTER; setTextColor(Tone.TEXT) }, LayoutParams(-1, -1))
        addView(face, LayoutParams(-1, -1))
        contentDescription = name
    }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        val target = url?.takeIf { it.isNotBlank() } ?: return
        val token = ++generation
        fun decode(bytes: ByteArray) {
            if (bytes.size > 4 * 1024 * 1024) return
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 256) sample *= 2
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return
            Handler(Looper.getMainLooper()).post { if (generation == token && isAttachedToWindow) face.setImageBitmap(bitmap) else bitmap.recycle() }
        }
        if (target.startsWith("/avatars/")) {
            assets.execute { runCatching { context.assets.open("public${target}").use { decode(it.readBytes()) } } }
            return
        }
        val request = runCatching { Request.Builder().url(target).build() }.getOrNull() ?: return
        call = client.newCall(request).also { it.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = Unit
            override fun onResponse(call: Call, response: Response) { response.use {
                if (it.isSuccessful && (it.body.contentLength() <= 4 * 1024 * 1024)) {
                    val bytes = it.body.byteStream().use { input -> val output = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (output.size() <= 4 * 1024 * 1024) {
                            val n = input.read(buffer, 0, minOf(buffer.size, 4 * 1024 * 1024 + 1 - output.size()))
                            if (n < 0) break
                            output.write(buffer, 0, n)
                        }
                        output.toByteArray() }
                    decode(bytes)
                }
            } }
        }) }
    }
    override fun onDetachedFromWindow() { generation++; call?.cancel(); call = null; super.onDetachedFromWindow() }
    companion object { private val assets = Executors.newSingleThreadExecutor() }
}
