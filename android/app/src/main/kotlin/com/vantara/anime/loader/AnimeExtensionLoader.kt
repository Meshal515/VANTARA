package com.vantara.anime.loader

import android.content.Context
import android.content.pm.PackageManager
import dalvik.system.DexClassLoader
import com.vantara.anime.registry.ExtensionRef
import eu.kanade.tachiyomi.animesource.AnimeCatalogueSource
import eu.kanade.tachiyomi.animesource.AnimeSource
import eu.kanade.tachiyomi.animesource.AnimeSourceFactory
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.awaitSuccess
import okhttp3.OkHttpClient
import java.io.File
import java.security.MessageDigest

/**
 * تحميل إضافة أنمي من ملف في تخزين التطبيق الخاص (نفس طريقة محرك المانجا:
 * لا تثبيت ولا صلاحية).
 *
 *   تنزيل ← SHA-256 مقابل البيان ← كتابة ثم read-only (أندرويد 14 يرفض
 *   تحميل كود من ملف قابل للكتابة) ← هوية الحزمة ← DexClassLoader أبوه
 *   محمِّلنا (فترى الإضافة `eu.kanade.tachiyomi.animesource.*`).
 *
 * ما يختلف عن المانجا: مفاتيح البيانات الوصفية (`tachiyomi.animeextension.*`)،
 * وإصدار المكتبة من `versionName` (14.26 ← 14)، والواجهات (AnimeSource).
 */
class AnimeExtensionLoader(context: Context, private val http: OkHttpClient) {

    private val appContext = context.applicationContext
    private val dir = File(appContext.filesDir, "anime-extensions").apply { mkdirs() }
    private val optDir = File(appContext.codeCacheDir, "anime-ext-opt").apply { mkdirs() }

    class LoadException(val stage: String, message: String, cause: Throwable? = null) : Exception("[$stage] $message", cause)

    /**
     * الملف المحلي إن بقيت بايتاته مطابقة للبصمة، ثم النسخة المضمّنة في التطبيق
     * (`assets/anime-extensions`، tools/bundle-anime-extensions.mjs)، والتنزيل آخرًا:
     * المستودع يحذف الإصدارات القديمة فيصير الرابط المثبّت 404 («تعذّر تنزيل»).
     */
    private fun vaultFile(ref: ExtensionRef): File {
        require(Regex("^[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)+$").matches(ref.pkg)) { "INVALID_EXTENSION_PACKAGE" }
        require(Regex("^[a-fA-F0-9]{64}$").matches(ref.sha256)) { "INVALID_EXTENSION_HASH" }
        return File(File(dir, "vault/${ref.pkg}"), "${ref.sha256.lowercase()}.apk")
    }

    private fun verifiedLocalBytes(ref: ExtensionRef): ByteArray? =
        listOf(vaultFile(ref), File(dir, "${ref.pkg}.apk")).firstNotNullOfOrNull { file ->
            file.takeIf { it.isFile }?.let { runCatching { it.readBytes() }.getOrNull() }
                ?.takeIf { sha256(it).equals(ref.sha256, true) }
        }

    suspend fun obtain(ref: ExtensionRef): AnimeCatalogueSource {
        return try {
            // Legacy <pkg>.apk is copied into the immutable vault only after
            // its pinned SHA-256 matches. Never delete the last working version.
            val bytes = verifiedLocalBytes(ref) ?: bundled(ref) ?: download(ref)
            load(ref, bytes)
        } catch (currentFailure: Exception) {
            val old = ref.fallback ?: throw currentFailure
            if (old.sha256.equals(ref.sha256, ignoreCase = true)) throw currentFailure
            val previousRef = ref.copy(apk = old.apk, sha256 = old.sha256, version = old.version, fallback = null)
            // Only a locally verified previous version may be used for offline
            // recovery; a stale repository URL never silently changes the pin.
            val previousBytes = verifiedLocalBytes(previousRef) ?: throw currentFailure
            try {
                load(previousRef, previousBytes).also {
                    android.util.Log.w("AnimeExtensionLoader", "LAST_KNOWN_GOOD_USED: ${ref.pkg}")
                }
            } catch (previousFailure: Exception) {
                currentFailure.addSuppressed(previousFailure)
                throw currentFailure
            }
        }
    }

    /** Remove only this package after the installed manifest no longer refers to it. */
    fun erase(pkg: String) {
        require(Regex("^[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)+$").matches(pkg)) { "INVALID_EXTENSION_PACKAGE" }
        File(dir, "vault/$pkg").listFiles()?.forEach { it.setWritable(true, true); it.delete() }
        File(dir, "vault/$pkg").delete()
        File(dir, "$pkg.apk").let { if (it.exists()) { it.setWritable(true, true); it.delete() } }
    }

    private fun bundled(ref: ExtensionRef): ByteArray? = runCatching {
        appContext.assets.open("$BUNDLED/${ref.pkg}.apk").use { it.readBytes() }
    }.getOrNull()?.takeIf { sha256(it).equals(ref.sha256, true) }

    private suspend fun download(ref: ExtensionRef): ByteArray = try {
        http.newCall(GET(ref.apk)).awaitSuccess().use { it.body.bytes() }
    } catch (t: Throwable) {
        throw LoadException("download", "تعذّر تنزيل ${ref.pkg}", t)
    }

    fun load(ref: ExtensionRef, bytes: ByteArray): AnimeCatalogueSource {
        val catalogue = loadSources(ref, bytes)
        val exact = ref.sourceId?.let { id -> catalogue.firstOrNull { it.id.toString() == id } }
        val named = ref.sourceName?.let { name -> catalogue.filter { it.name == name }.singleOrNull() }
        if (ref.sourceId != null || ref.sourceName != null) {
            return exact ?: named ?: throw LoadException("identity", "مصدر الإضافة المطلوب لم يعد موجودًا")
        }
        return catalogue.firstOrNull { it.lang == "ar" } ?: catalogue.first()
    }

    /** Enumerate every catalogue source in the signed APK, not only the first one. */
    fun loadSources(ref: ExtensionRef, bytes: ByteArray): List<AnimeCatalogueSource> {
        val actual = sha256(bytes)
        if (!actual.equals(ref.sha256, ignoreCase = true)) {
            throw LoadException("verify", "بصمة مختلفة: متوقع ${ref.sha256.take(12)}… وصل ${actual.take(12)}…")
        }
        // Each version is immutable and keyed by its hash. A broken update
        // cannot overwrite the last verified release (nor the legacy APK).
        val apk = vaultFile(ref)
        if (!apk.isFile || runCatching { sha256(apk.readBytes()) }.getOrNull() != actual) {
            val stage = File(apk.parentFile, "${ref.sha256}.${System.nanoTime()}.part")
            try {
                check(apk.parentFile?.mkdirs() == true || apk.parentFile?.isDirectory == true)
                stage.writeBytes(bytes)
                if (!stage.setWritable(false, false) || stage.canWrite()) throw LoadException("readonly", "ملف الإضافة لم يصبح للقراءة فقط")
                if (apk.exists()) { apk.setWritable(true, true); check(apk.delete()) }
                if (!stage.renameTo(apk)) throw LoadException("write", "تعذّر تثبيت النسخة الموثقة")
            } catch (error: Exception) {
                throw LoadException("write", "تعذّرت كتابة الإضافة دون المساس بالإصدار السابق", error)
            } finally { if (stage.exists()) { stage.setWritable(true, true); stage.delete() } }
        }
        apk.setWritable(false, false)
        if (apk.canWrite()) throw LoadException("readonly", "الملف ما زال قابلًا للكتابة")

        @Suppress("DEPRECATION")
        val info = appContext.packageManager.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_META_DATA)
            ?: throw LoadException("parse", "ليس APK صالحًا")
        if (info.packageName != ref.pkg) throw LoadException("identity", "الحزمة ${info.packageName} ليست ${ref.pkg}")
        val lib = info.versionName?.substringBefore('.')?.toIntOrNull()
        if (lib == null || lib !in LIB_MIN..LIB_MAX) throw LoadException("lib", "مكتبة إضافات غير مدعومة: ${info.versionName}")
        val meta = info.applicationInfo?.metaData ?: throw LoadException("parse", "لا بيانات وصفية")
        val names = meta.getString(META_CLASS) ?: meta.getString(META_FACTORY)
            ?: throw LoadException("parse", "لا $META_CLASS")

        val loader = runCatching { DexClassLoader(apk.absolutePath, optDir.absolutePath, null, javaClass.classLoader) }
            .getOrElse { throw LoadException("classloader", "رفض DexClassLoader الملف", it) }

        val sources = mutableListOf<AnimeSource>()
        for (name in names.split(';', ',').map { it.trim() }.filter { it.isNotEmpty() }) {
            val fq = if (name.startsWith('.')) ref.pkg + name else name
            val instance = runCatching { loader.loadClass(fq).getDeclaredConstructor().newInstance() }
                .getOrElse { throw LoadException("instantiate", "تعذّر إنشاء $fq", it) }
            when (instance) {
                is AnimeSourceFactory -> sources += instance.createSources()
                is AnimeSource -> sources += instance
                else -> throw LoadException("instantiate", "$fq ليس مصدر أنمي")
            }
        }
        val catalogue = sources.filterIsInstance<AnimeCatalogueSource>()
        if (catalogue.isEmpty()) throw LoadException("instantiate", "الإضافة لا تحمل مصدر كتالوج")
        return catalogue
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private companion object {
        const val BUNDLED = "anime-extensions"
        const val META_CLASS = "tachiyomi.animeextension.class"
        const val META_FACTORY = "tachiyomi.animeextension.factory"
        const val LIB_MIN = 14
        const val LIB_MAX = 16
    }
}
