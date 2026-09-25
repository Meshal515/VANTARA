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

    /** الملف المحلي إن بقيت بايتاته مطابقة للبصمة، وإلا تنزيل جديد. */
    suspend fun obtain(ref: ExtensionRef): AnimeCatalogueSource {
        val cached = File(dir, "${ref.pkg}.apk").takeIf { it.isFile }?.readBytes()?.takeIf { sha256(it).equals(ref.sha256, true) }
        val bytes = cached ?: download(ref)
        return load(ref, bytes)
    }

    private suspend fun download(ref: ExtensionRef): ByteArray = try {
        http.newCall(GET(ref.apk)).awaitSuccess().use { it.body.bytes() }
    } catch (t: Throwable) {
        throw LoadException("download", "تعذّر تنزيل ${ref.pkg}", t)
    }

    fun load(ref: ExtensionRef, bytes: ByteArray): AnimeCatalogueSource {
        val actual = sha256(bytes)
        if (!actual.equals(ref.sha256, ignoreCase = true)) {
            throw LoadException("verify", "بصمة مختلفة: متوقع ${ref.sha256.take(12)}… وصل ${actual.take(12)}…")
        }
        val apk = File(dir, "${ref.pkg}.apk")
        runCatching {
            if (apk.exists()) {
                apk.setWritable(true, true)
                apk.delete()
            }
            apk.writeBytes(bytes)
        }.onFailure { throw LoadException("write", "تعذّرت كتابة الإضافة", it) }
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
        return (ref.sourceName?.let { n -> catalogue.firstOrNull { it.name == n } } ?: catalogue.firstOrNull { it.lang == "ar" } ?: catalogue.firstOrNull())
            ?: throw LoadException("instantiate", "الإضافة لا تحمل مصدر كتالوج")
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private companion object {
        const val META_CLASS = "tachiyomi.animeextension.class"
        const val META_FACTORY = "tachiyomi.animeextension.factory"
        const val LIB_MIN = 14
        const val LIB_MAX = 16
    }
}
