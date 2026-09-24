package com.vantara.plugins

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

/**
 * التحديث بزرّ واحد، بطريقين:
 *
 * 1. **الواجهة** (أغلب التحديثات): حزمة الويب تُنزَّل وتُتحقق بصمتها وتُفكّ في
 *    `files/web/<version>`، ثم يشير Capacitor إليها (`WebView.setServerBasePath`
 *    و`persistServerBasePath` من الجافاسكربت). بلا APK جديد ولا مثبّت أندرويد.
 *    وحين يُثبَّت APK أحدث يمحو Capacitor المسار تلقائيًا (`isNewBinary`) فلا
 *    تبقى واجهة قديمة فوق كود جديد.
 *
 * 2. **الكود الأصلي** (نادر: إضافة، إذن، محرّك): الـAPK يُنزَّل ويُتحقق ثم يُفتح
 *    مثبّت أندرويد نفسه. أندرويد يطلب مرة واحدة إذن «تثبيت تطبيقات من هذا
 *    المصدر»، ويسأل «تحديث؟» في كل مرة — هذا من النظام ولا يُتجاوز.
 *
 * `NATIVE_API` يُرفع مع كل تغيير في كود أندرويد: واجهةٌ بُنيت لرقم آخر لا
 * تُطبَّق فوق هذا التطبيق، ويُعرض تحديث الـAPK بدلها.
 */
@CapacitorPlugin(name = "AppUpdate")
class AppUpdatePlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val http by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    override fun handleOnDestroy() {
        scope.cancel()
    }

    @PluginMethod
    fun info(call: PluginCall) {
        val pm = context.packageManager
        val pkg = pm.getPackageInfo(context.packageName, 0)
        val prefs = context.getSharedPreferences("CapWebViewSettings", 0)
        call.resolve(
            JSObject()
                .put("versionCode", PackageInfoCompat.getLongVersionCode(pkg))
                .put("versionName", pkg.versionName)
                .put("nativeApi", NATIVE_API)
                .put("basePath", prefs.getString("serverBasePath", "") ?: "")
                .put("canInstall", Build.VERSION.SDK_INT < Build.VERSION_CODES.O || pm.canRequestPackageInstalls()),
        )
    }

    /** البيان من رابط ثابت (آخر إصدار على GitHub). من هنا لا من WebView: بلا CORS. */
    @PluginMethod
    fun manifest(call: PluginCall) {
        val url = call.getString("url")?.takeIf { it.startsWith("https://") } ?: return call.reject("https url required")
        scope.launch {
            try {
                val body = http.newCall(Request.Builder().url(url).header("Cache-Control", "no-cache").build()).execute().use { res ->
                    require(res.isSuccessful) { "manifest HTTP ${res.code}" }
                    res.body.string()
                }
                call.resolve(JSObject().put("json", body))
            } catch (t: Throwable) {
                call.reject(t.message ?: "manifest failed")
            }
        }
    }

    /** حزمة الواجهة: تنزيل ← بصمة ← فكّ آمن ← مسارها. القديم يُمسح إلا السابق. */
    @PluginMethod
    fun downloadWeb(call: PluginCall) {
        val url = call.getString("url")?.takeIf { it.startsWith("https://") } ?: return call.reject("https url required")
        val sha = call.getString("sha256")?.lowercase() ?: return call.reject("sha256 required")
        val version = call.getString("version")?.filter { it.isLetterOrDigit() || it == '.' || it == '-' } ?: return call.reject("version required")
        scope.launch {
            try {
                val zip = File(context.cacheDir, "updates/web-$version.zip").apply { parentFile?.mkdirs() }
                download(url, zip, sha)
                val root = File(context.filesDir, "web")
                val target = File(root, version)
                val staging = File(root, "$version.partial")
                staging.deleteRecursively()
                staging.mkdirs()
                unzip(zip, staging)
                require(File(staging, "index.html").isFile) { "bundle has no index.html" }
                target.deleteRecursively()
                require(staging.renameTo(target)) { "could not place bundle" }
                zip.delete()
                // الحالية والسابقة تكفيان للرجوع
                val prefs = context.getSharedPreferences("CapWebViewSettings", 0)
                val current = prefs.getString("serverBasePath", "") ?: ""
                root.listFiles()?.filter { it.isDirectory && it != target && it.absolutePath != current }?.forEach { it.deleteRecursively() }
                // يُحفظ هنا لا من الواجهة: `setServerBasePath` يعيد تحميل الصفحة فورًا،
                // ونداء الحفظ بعده قد لا يصل أبدًا. Capacitor يقرأ هذا المفتاح في كل إقلاع
                prefs.edit().putString("serverBasePath", target.absolutePath).commit()
                call.resolve(JSObject().put("path", target.absolutePath))
            } catch (t: Throwable) {
                call.reject(t.message ?: "web update failed")
            }
        }
    }

    /**
     * الـAPK: تنزيل ← بصمة ← مثبّت أندرويد. أول مرة يفتح إعداد «السماح من هذا
     * المصدر» ويرجع `needsPermission`، والواجهة تطلب الضغطة مرة ثانية بعده.
     */
    @PluginMethod
    fun installApk(call: PluginCall) {
        val url = call.getString("url")?.takeIf { it.startsWith("https://") } ?: return call.reject("https url required")
        val sha = call.getString("sha256")?.lowercase() ?: return call.reject("sha256 required")
        val pm = context.packageManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !pm.canRequestPackageInstalls()) {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            return call.resolve(JSObject().put("needsPermission", true))
        }
        scope.launch {
            try {
                val apk = File(context.cacheDir, "updates/VANTARA.apk").apply { parentFile?.mkdirs() }
                download(url, apk, sha)
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
                val intent = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                call.resolve(JSObject().put("started", true))
            } catch (t: Throwable) {
                call.reject(t.message ?: "apk update failed")
            }
        }
    }

    private fun download(url: String, out: File, sha: String) {
        val digest = MessageDigest.getInstance("SHA-256")
        http.newCall(Request.Builder().url(url).build()).execute().use { res ->
            require(res.isSuccessful) { "download HTTP ${res.code}" }
            val total = res.body.contentLength()
            var received = 0L
            var lastEmit = 0L
            out.outputStream().use { sink ->
                res.body.byteStream().use { input ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        sink.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        received += n
                        val now = System.currentTimeMillis()
                        if (now - lastEmit > 250) {
                            lastEmit = now
                            notifyListeners("progress", JSObject().put("received", received).put("total", total))
                        }
                    }
                }
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (actual != sha) {
            out.delete()
            error("sha256 mismatch")
        }
    }

    /** فكٌّ بلا خروج من المجلد (zip-slip): اسمٌ يقفز خارج الهدف يرفض الحزمة كلها. */
    private fun unzip(zip: File, into: File) {
        val base = into.canonicalPath + File.separator
        ZipInputStream(zip.inputStream().buffered()).use { zin ->
            while (true) {
                val entry = zin.nextEntry ?: break
                val file = File(into, entry.name)
                require(file.canonicalPath.startsWith(base)) { "bad entry ${entry.name}" }
                if (entry.isDirectory) {
                    file.mkdirs()
                } else {
                    file.parentFile?.mkdirs()
                    file.outputStream().use { zin.copyTo(it) }
                }
                zin.closeEntry()
            }
        }
    }

    companion object {
        /** يُرفع مع أي تغيير في كود أندرويد أو إضافاته. CI يقرؤه من هنا. */
        const val NATIVE_API = 1
    }
}
