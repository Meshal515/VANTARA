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
    suspend fun obtain(ref: ExtensionRef): AnimeCatalogueSource {
        val stored = archive(ref)
        val cached = sequenceOf(stored, File(dir, "${ref.pkg}.apk"))
            .mapNotNull { apk -> runCatching { apk.takeIf { it.isFile }?.readBytes() }.getOrNull() }
            .firstOrNull { sha256(it).equals(ref.sha256, true) }
        val bytes = cached ?: bundled(ref) ?: download(ref)
        return load(ref, bytes)
    }

    /** Verified, content-addressed APK vault; updates do not overwrite the working version. */
    private fun archive(ref: ExtensionRef): File {
        require(ref.pkg.matches(Regex("^[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)+$"))) { "invalid APK package" }
        require(ref.sha256.matches(Regex("(?i)[a-f0-9]{64}"))) { "invalid APK sha256" }
        return File(File(dir, "vault/${ref.pkg}"), "${ref.sha256.lowercase()}.apk")
    }

    private fun bundled(ref: ExtensionRef): ByteArray? = runCatching {
        appContext.assets.open("$BUNDLED/${ref.pkg}.apk").use { it.readBytes() }
    }.getOrNull()?.takeIf { sha256(it).equals(ref.sha256, true) }

    private suspend fun download(ref: ExtensionRef): ByteArray = try {
        http.newCall(GET(ref.apk)).awaitSuccess().use { it.body.bytes() }
    } catch (t: Throwable) {
        throw LoadException("download", "تعذّر تنزيل ${ref.pkg}", t)
    }

    /** Enumerates every catalogue source from an actual APK/factory before committing. */
    fun inspect(ref: ExtensionRef, bytes: ByteArray): List<AnimeCatalogueSource> {
        val actual = sha256(bytes)
        if (!actual.equals(ref.sha256, ignoreCase = true)) {
            throw LoadException("verify", "بصمة مختلفة: متوقع ${ref.sha256.take(12)}… وصل ${actual.take(12)}…")
        }
        val apk = archive(ref)
        runCatching {
            apk.parentFile?.mkdirs()
            val existing = runCatching { apk.takeIf { it.isFile }?.readBytes() }.getOrNull()
            if (existing == null || !sha256(existing).equals(actual, true)) {
                val stage = File(apk.parentFile, "${actual}.${System.nanoTime()}.part")
                try {
                    stage.writeBytes(bytes)
                    stage.setWritable(false, false)
                    if (stage.canWrite()) error("staged APK is writable")
                    if (!stage.renameTo(apk)) error("cannot stage verified APK into vault")
                } finally {
                    if (stage.exists()) { stage.setWritable(true, true); stage.delete() }
                }
            }
            apk.setWritable(false, false)
        }.onFailure { throw LoadException("write", "تعذّرت كتابة الإضافة دون المساس بالإصدار السابق", it) }
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
        require(catalogue.map { it.id.toString() }.toSet().size == catalogue.size) {
            "DUPLICATE_SOURCE_ID: الحزمة تعلن معرّفات مصادر مكررة"
        }
        return catalogue
    }

    fun load(ref: ExtensionRef, bytes: ByteArray): AnimeCatalogueSource {
        val catalogue = inspect(ref, bytes)
        val selected = ref.sourceId?.let { id ->
            catalogue.firstOrNull { it.id.toString() == id }
                ?: throw LoadException("identity", "المصدر $id غير موجود في حزمة ${ref.pkg}")
        } ?: ref.sourceName?.let { name ->
            catalogue.firstOrNull { it.name == name }
                ?: throw LoadException("identity", "المصدر $name غير موجود في حزمة ${ref.pkg}")
        } ?: catalogue.firstOrNull { it.lang == "ar" } ?: catalogue.firstOrNull()
        return selected ?: throw LoadException("instantiate", "الإضافة لا تحمل مصدر كتالوج")
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
