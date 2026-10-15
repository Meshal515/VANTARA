package com.vantara.plugins

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.pm.PackageInfoCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.vantara.app.BuildConfig
import com.vantara.plugins.update.ApkCheck
import com.vantara.plugins.update.WebBundleState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

/**
 * التحديث، بطريقين:
 *
 * 1. **الواجهة** — أغلب التحديثات، تلقائيًا بلا سؤال:
 *    تنزل في الخلفية ← بصمتها (sha256) ← فكّ آمن ← `vantara-bundle.json`
 *    يطابق الإصدار وبصمة الكود الأصلي ← staged. تُعرض في الإقلاع التالي،
 *    وتبقى «تجربة» حتى تنادي الواجهة `healthy`. لم تنادِ خلال المهلة أو خلال
 *    إقلاعين ← رجوع تلقائي لآخر حزمة سليمة، أو للمدمجة في الـAPK.
 *    المنطق كله في [WebBundleState].
 *
 * 2. **الكود الأصلي** — APK، بزر «تثبيت»:
 *    تنزيل ← sha256 ← [ApkCheck]: نفس الحزمة، مفتاح VANTARA الرسمي، نفس
 *    مفتاح المثبّت، رقم أحدث ← `PackageInstaller` (جلسة رسمية). أندرويد يعرض
 *    تأكيده دائمًا؛ لا تثبيت صامت. يثبت فوق التطبيق فتبقى بياناته.
 *
 * `BuildConfig.VANTARA_NATIVE` بصمة كل ما يُبنى في الـAPK (يحسبها CI من
 * `tools/native-fingerprint.mjs`). حزمة واجهة لبصمة أخرى لا تُعرض أبدًا.
 */
@CapacitorPlugin(name = "AppUpdate")
class AppUpdatePlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())
    private val http by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }
    private lateinit var state: WebBundleState
    private var lastBoot: WebBundleState.Boot = WebBundleState.Boot.Nothing

    private val webRoot get() = File(context.filesDir, "web")

    override fun load() {
        instance = this
        state = stateFor(context)
        // يُنادى قبل أن يقرأ Capacitor مسار الواجهة (Bridge: registerAllPlugins
        // ثم loadWebView)، فالرجوع أو الترقية يسريان على هذا الإقلاع نفسه
        lastBoot = state.onBoot()
        (lastBoot as? WebBundleState.Boot.Trial)?.let { watch(it.version) }
        scope.launch { prune() }
    }

    override fun handleOnDestroy() {
        if (instance === this) instance = null
        scope.cancel()
    }

    /** مراقب: واجهة تجريبية لم تؤكد نفسها في المهلة ← رجوع فوري لا في الإقلاع القادم. */
    private fun watch(version: String) {
        main.postDelayed({
            if (!state.inTrial(version)) return@postDelayed
            val path = state.rollback()
            if (path.isEmpty()) bridge.setServerAssetPath("public") else bridge.setServerBasePath(path)
        }, WATCHDOG_MS)
    }

    @PluginMethod
    fun info(call: PluginCall) {
        val pm = context.packageManager
        val pkg = pm.getPackageInfo(context.packageName, 0)
        call.resolve(
            JSObject()
                .put("versionCode", PackageInfoCompat.getLongVersionCode(pkg))
                .put("versionName", pkg.versionName)
                .put("native", BuildConfig.VANTARA_NATIVE)
                // للبيانات القديمة: نسخة 0.0.3 تقارن هذا الرقم
                .put("nativeApi", NATIVE_API)
                .put("official", signerDigests(installedInfo()) == setOf(ApkCheck.STABLE_CERT_SHA256))
                .put("staged", state.stagedVersion())
                .put("good", state.goodVersion())
                .put("bad", org.json.JSONArray(state.bad().toList()))
                .put("canInstall", pm.canRequestPackageInstalls()),
        )
    }

    /** البيان من رابط ثابت. من هنا لا من WebView: بلا CORS. */
    @PluginMethod
    fun manifest(call: PluginCall) {
        val url = httpsUrl(call) ?: return
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

    /**
     * الواجهة المعروضة تعمل. الواجهة تناديها بعد أول شاشة.
     * `confirmed`: هذه أول مرة تُعتمد فيها هذه النسخة (تحدّثت للتوّ).
     */
    @PluginMethod
    fun healthy(call: PluginCall) {
        val version = call.getString("version") ?: ""
        val confirmed = state.healthy(version)
        if (confirmed) scope.launch { prune() }
        val rolledBack = (lastBoot as? WebBundleState.Boot.RolledBack)?.version
        call.resolve(JSObject().put("confirmed", confirmed).put("rolledBack", rolledBack))
    }

    /** حزمة الواجهة: تنزيل ← بصمة ← فكّ آمن ← تطابق ← staged. لا تُعرض الآن. */
    @PluginMethod
    fun downloadWeb(call: PluginCall) {
        val url = httpsUrl(call) ?: return
        val sha = call.getString("sha256")?.lowercase() ?: return call.reject("sha256 required")
        val version = call.getString("version")?.filter { it.isLetterOrDigit() || it == '.' || it == '-' }
            ?: return call.reject("version required")
        if (BuildConfig.VANTARA_NATIVE == DEV) return call.reject("dev build")
        if (version in state.bad()) return call.reject("bad version")
        scope.launch {
            val staging = File(webRoot, "$version.partial")
            try {
                val zip = File(context.cacheDir, "updates/web-$version.zip").apply { parentFile?.mkdirs() }
                download(url, zip, sha)
                staging.deleteRecursively()
                staging.mkdirs()
                unzip(zip, staging)
                zip.delete()
                require(File(staging, "index.html").isFile) { "bundle has no index.html" }
                val meta = JSONObject(File(staging, BUNDLE_META).readText())
                require(meta.optString("version") == version) { "bundle version mismatch" }
                require(meta.optString("native") == BuildConfig.VANTARA_NATIVE) { "bundle built for other native code" }
                val target = File(webRoot, version)
                target.deleteRecursively()
                require(staging.renameTo(target)) { "could not place bundle" }
                require(state.stage(target.absolutePath, version, meta.optString("native"))) { "not staged" }
                prune()
                call.resolve(JSObject().put("staged", version))
            } catch (t: Throwable) {
                staging.deleteRecursively()
                call.reject(t.message ?: "web update failed")
            }
        }
    }

    /** يعرض الحزمة الجاهزة الآن (رجوع من الخلفية بعد مدة). يعيد تحميل الصفحة. */
    @PluginMethod
    fun activate(call: PluginCall) {
        val promoted = state.promoteNow() ?: return call.resolve(JSObject().put("activated", false))
        call.resolve(JSObject().put("activated", true))
        main.post {
            bridge.setServerBasePath(promoted.first)
            watch(promoted.second)
        }
    }

    /** يدويًا من «النظام»: الرجوع للواجهة المدمجة في الـAPK. */
    @PluginMethod
    fun reset(call: PluginCall) {
        state.reset()
        call.resolve()
        main.post { bridge.setServerAssetPath("public") }
        scope.launch { prune() }
    }

    /**
     * الـAPK. بلا إذن «تثبيت تطبيقات غير معروفة» يفتح إعداده ويرجع
     * `needsPermission`؛ الواجهة تكمل وحدها بعد الرجوع. نتيجة التثبيت تصل
     * حدثًا `installResult`.
     */
    @PluginMethod
    fun installApk(call: PluginCall) {
        val url = httpsUrl(call) ?: return
        val sha = call.getString("sha256")?.lowercase() ?: return call.reject("sha256 required")
        val pm = context.packageManager
        if (!pm.canRequestPackageInstalls()) {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            return call.resolve(JSObject().put("needsPermission", true))
        }
        scope.launch {
            try {
                val apk = File(context.cacheDir, "updates/VANTARA.apk").apply { parentFile?.mkdirs() }
                download(url, apk, sha)
                val verdict = ApkCheck.verify(candidateInfo(apk), describe(installedInfo()))
                if (verdict != ApkCheck.Verdict.OK) {
                    apk.delete()
                    return@launch call.reject(verdict.name, verdict.name)
                }
                commitSession(apk)
                call.resolve(JSObject().put("started", true))
            } catch (t: Throwable) {
                call.reject(t.message ?: "apk update failed")
            }
        }
    }

    private fun commitSession(apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
            // صراحةً: أندرويد يعرض تأكيده دائمًا، حتى حين يسمح بغير ذلك
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
            }
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("base.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out, 256 * 1024) }
                session.fsync(out)
            }
            val result = Intent(context, InstallResultReceiver::class.java).setPackage(context.packageName)
            // MUTABLE لازم: النظام يكتب الحالة داخل هذا الـIntent
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            session.commit(PendingIntent.getBroadcast(context, id, result, flags).intentSender)
        }
    }

    internal fun onInstallResult(status: Int, message: String?) {
        val kind = when (status) {
            PackageInstaller.STATUS_SUCCESS -> "success"
            PackageInstaller.STATUS_FAILURE_ABORTED -> "cancelled"
            PackageInstaller.STATUS_FAILURE_STORAGE -> "storage"
            PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "conflict"
            else -> "failed"
        }
        notifyListeners("installResult", JSObject().put("status", kind).put("message", message ?: ""))
    }

    private fun installedInfo(): PackageInfo = context.packageManager.getPackageInfo(context.packageName, SIGNING_FLAGS)

    private fun candidateInfo(apk: File): ApkCheck.Apk? =
        context.packageManager.getPackageArchiveInfo(apk.absolutePath, SIGNING_FLAGS)?.let(::describe)

    private fun describe(info: PackageInfo) =
        ApkCheck.Apk(info.packageName, PackageInfoCompat.getLongVersionCode(info), signerDigests(info))

    @Suppress("DEPRECATION")
    private fun signerDigests(info: PackageInfo): Set<String> {
        val signers = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo != null) {
            info.signingInfo!!.apkContentsSigners
        } else {
            info.signatures
        } ?: return emptySet()
        return signers.map { sha256(it.toByteArray()) }.toSet()
    }

    private fun httpsUrl(call: PluginCall): String? {
        val url = call.getString("url")?.takeIf { it.startsWith("https://") }
        if (url == null) call.reject("https url required")
        return url
    }

    /** ما لا يلزم: غير الحالية والسابقة والجاهزة. */
    private fun prune() {
        val keep = state.keep()
        webRoot.listFiles()?.filter { it.isDirectory && it.absolutePath !in keep }?.forEach { it.deleteRecursively() }
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
        /**
         * للبيانات القديمة فقط: نسخة 0.0.3 تعرض الـAPK حين يختلف هذا الرقم.
         * القرار الآن ببصمة `BuildConfig.VANTARA_NATIVE`، فلا يُرفع باليد.
         */
        const val NATIVE_API = 2
        const val DEV = "dev"
        const val BUNDLE_META = "vantara-bundle.json"
        private const val WATCHDOG_MS = 20_000L
        private const val PREFS = "VantaraWebUpdate"
        private const val CAP_PREFS = "CapWebViewSettings"

        @Suppress("DEPRECATION")
        private val SIGNING_FLAGS =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

        @Volatile internal var instance: AppUpdatePlugin? = null

        fun sha256(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

        private fun stateFor(context: Context): WebBundleState {
            fun prefs(name: String) = context.getSharedPreferences(name, Context.MODE_PRIVATE).let { p ->
                object : WebBundleState.KeyValue {
                    override fun get(key: String) = p.getString(key, null)
                    // commit لا apply: الإقلاع التالي قد يكون بعد انهيار
                    override fun put(key: String, value: String?) {
                        p.edit().apply { if (value == null) remove(key) else putString(key, value) }.commit()
                    }
                }
            }
            return WebBundleState(prefs(PREFS), prefs(CAP_PREFS), { File(it, "index.html").isFile }, BuildConfig.VANTARA_NATIVE)
        }
    }
}
