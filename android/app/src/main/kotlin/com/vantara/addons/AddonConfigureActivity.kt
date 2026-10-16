package com.vantara.addons

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast

/**
 * صفحة إعداد الإضافة داخل VANTARA. زر «Install» في الصفحة لا يفتح Stremio: نلتقط رابطه
 * ونرجعه للتطبيق فيثبّت الإضافة بإعداداتك. الصفحة نفسها تعمل كما في المتصفح (JS
 * والكوكيز وتسجيل الدخول إن احتاجت).
 */
class AddonConfigureActivity : Activity() {
    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_MANIFEST = "manifest"
    }

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val start = intent.getStringExtra(EXTRA_URL)
        if (start == null || !start.startsWith("https://", ignoreCase = true)) { finish(); return }
        window.statusBarColor = Color.parseColor("#08080a")
        val dp = { v: Int -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt() }

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#08080a")) }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(16), dp(10), dp(8), dp(10))
        }
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titles.addView(TextView(this).apply {
            text = "إعداد الإضافة"; setTextColor(Color.WHITE); textSize = 16f; typeface = Typeface.DEFAULT_BOLD
        })
        val hint = TextView(this).apply {
            text = "اضغط Install في آخر الصفحة لتُضاف إلى VANTARA"
            setTextColor(Color.parseColor("#9a9aa6")); textSize = 12.5f
        }
        titles.addView(hint)
        bar.addView(titles, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(TextView(this).apply {
            text = "إغلاق"; setTextColor(Color.WHITE); textSize = 14f
            setPadding(dp(14), dp(8), dp(14), dp(8))
            setOnClickListener { cancel() }
        })
        root.addView(bar)
        val progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; isIndeterminate = false }
        root.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // target=_blank وwindow.open تفتح في نفس النافذة فنلتقط روابطها هنا
            settings.setSupportMultipleWindows(false)
            setBackgroundColor(Color.parseColor("#08080a"))
            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView, newProgress: Int) {
                    progress.progress = newProgress
                    progress.visibility = if (newProgress >= 100) View.INVISIBLE else View.VISIBLE
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = route(request.url.toString())
                @Deprecated("API < 24")
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = route(url)
            }
        }
        root.addView(FrameLayout(this).apply { addView(web) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        web.loadUrl(start)
    }

    /** true = لا تحمّل (التقطناه أو منعناه). */
    private fun route(url: String): Boolean {
        AddonConfigureLinks.manifestFrom(url)?.let { manifest ->
            setResult(RESULT_OK, Intent().putExtra(EXTRA_MANIFEST, manifest))
            finish()
            return true
        }
        if (url.startsWith("stremio:", ignoreCase = true)) {
            Toast.makeText(this, "رابط الإضافة غير صالح", Toast.LENGTH_SHORT).show()
            return true
        }
        return !AddonConfigureLinks.staysInside(url)
    }

    private fun cancel() { setResult(RESULT_CANCELED); finish() }

    @Deprecated("Activity back")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else cancel()
    }

    override fun onDestroy() {
        if (::web.isInitialized) { web.stopLoading(); web.destroy() }
        super.onDestroy()
    }
}
