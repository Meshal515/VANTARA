package com.vantara.plugins

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import dev.vantara.spike.ContentWarning
import dev.vantara.spike.SourceSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.net.URI
import java.security.MessageDigest

/**
 * مستودعات إضافات المانجا التي يضيفها المستخدم (صيغة Mihon/Keiyoushi):
 *
 *   <base>/repo.json        { meta: { name, signingKeyFingerprint } }
 *   <base>/index.min.json   [{ name, pkg, apk, lang, version, nsfw, sources: [{ id, name, lang }] }]
 *   <base>/apk/<apk>
 *
 * الإضافة كود يعمل داخل التطبيق، فالثقة بالمستودع لا بالملف: كل APK يجب أن يكون
 * موقَّعًا بالمفتاح الذي أعلنه المستودع (كما في Mihon)، وبصمته SHA-256 تُثبَّت عند
 * التثبيت فلا يُحمَّل بعدها ملف تغيّر. إضافات الأنمي (Aniyomi) لها واجهة أخرى.
 */
object RepoIndex {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val SHA256 = Regex("^[0-9a-f]{64}$")

    data class Meta(val name: String, val fingerprint: String)
    data class Source(val id: String, val name: String, val lang: String)
    data class Extension(
        val name: String, val pkg: String, val apk: String, val lang: String, val version: String,
        val lib: Double, val nsfw: Boolean, val sources: List<Source>,
    ) {
        val anime: Boolean get() = pkg.contains(".animeextension.")
    }

    /** يقبل رابط المستودع نفسه أو رابط index.min.json/index.json/repo.json فيه. */
    fun base(input: String): String {
        val raw = input.trim().removeSuffix("/")
        val uri = runCatching { URI(raw) }.getOrNull() ?: error("رابط المستودع غير صالح")
        require(uri.scheme.equals("https", ignoreCase = true) && uri.host != null && uri.rawUserInfo == null && uri.port == -1) { "المستودع يحتاج رابط HTTPS عاديًا" }
        require(uri.rawQuery == null && uri.rawFragment == null) { "رابط المستودع لا يحمل استعلامًا" }
        return raw.replace(Regex("/(index\\.min\\.json|index\\.json|repo\\.json)$", RegexOption.IGNORE_CASE), "")
    }

    fun parseMeta(text: String): Meta {
        val meta = json.parseToJsonElement(text).jsonObject["meta"]?.jsonObject ?: error("repo.json بلا meta")
        val name = meta["name"]?.jsonPrimitive?.contentOrNull?.take(80)?.ifBlank { null } ?: error("المستودع بلا اسم")
        val fingerprint = meta["signingKeyFingerprint"]?.jsonPrimitive?.contentOrNull?.lowercase()?.replace(":", "")
        require(fingerprint != null && SHA256.matches(fingerprint)) { "المستودع لا يعلن مفتاح توقيع؛ لا نشغّل كودًا بلا توقيع معروف" }
        return Meta(name, fingerprint)
    }

    fun parseIndex(text: String): List<Extension> {
        val list = json.parseToJsonElement(text) as? JsonArray ?: error("index.min.json ليس قائمة")
        require(list.size <= 5000) { "المستودع أكبر من الحد" }
        return list.mapNotNull { element ->
            val o = element as? JsonObject ?: return@mapNotNull null
            val pkg = o["pkg"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val apk = o["apk"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            if (!Regex("^[A-Za-z0-9._-]+\\.apk$").matches(apk) || !Regex("^[A-Za-z0-9_.]+$").matches(pkg)) return@mapNotNull null
            val version = o["version"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val lib = version.split('.').take(2).joinToString(".").toDoubleOrNull() ?: return@mapNotNull null
            val sources = (o["sources"] as? JsonArray).orEmpty().mapNotNull { s ->
                val so = s as? JsonObject ?: return@mapNotNull null
                val id = so["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                Source(id, so["name"]?.jsonPrimitive?.contentOrNull ?: pkg, so["lang"]?.jsonPrimitive?.contentOrNull ?: "")
            }
            Extension(
                name = (o["name"]?.jsonPrimitive?.contentOrNull ?: pkg).removePrefix("Tachiyomi: ").removePrefix("Aniyomi: "),
                pkg = pkg, apk = apk, lang = o["lang"]?.jsonPrimitive?.contentOrNull ?: "",
                version = version, lib = lib, nsfw = (o["nsfw"]?.jsonPrimitive?.intOrNull ?: 0) == 1, sources = sources,
            )
        }
    }

    /** المصادر التي تظهر في التطبيق: العربية إن وُجدت، وإلا مصادر لغة الإضافة. */
    fun visibleSources(ext: Extension): List<Source> =
        ext.sources.filter { it.lang.equals("ar", ignoreCase = true) }.ifEmpty {
            ext.sources.filter { it.lang.equals(ext.lang, ignoreCase = true) }.ifEmpty { ext.sources.take(1) }
        }
}

@Serializable
data class UserRepo(val url: String, val name: String, val fingerprint: String)

@Serializable
data class UserSource(val id: String, val name: String, val lang: String)

@Serializable
data class UserExtension(
    val repoUrl: String, val name: String, val pkg: String, val apkUrl: String, val sha256: String,
    val versionName: String, val lib: Double, val lang: String, val nsfw: Boolean, val sources: List<UserSource>,
) {
    fun spec(): SourceSpec = SourceSpec(
        label = name, pkg = pkg, expectedLib = lib, apkUrl = apkUrl, sha256 = sha256, versionName = versionName,
        warning = if (nsfw) ContentWarning.MIXED else ContentWarning.SAFE,
        arabicSourceIds = sources.map { it.id }.toSet(), arabicSourceNames = sources.map { it.name },
    )
}

@Serializable
data class UserExtensionState(val repos: List<UserRepo> = emptyList(), val extensions: List<UserExtension> = emptyList())

/** الحالة في ملف خاص بالتطبيق؛ الكتابة ذرّية فلا يفسدها إغلاق مفاجئ. */
class UserExtensionStore(private val file: File) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    @Volatile var state: UserExtensionState = runCatching { json.decodeFromString<UserExtensionState>(file.readText()) }.getOrDefault(UserExtensionState())
        private set

    @Synchronized fun update(change: (UserExtensionState) -> UserExtensionState): UserExtensionState {
        val next = change(state)
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeText(json.encodeToString(UserExtensionState.serializer(), next))
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
        state = next
        return next
    }

    fun extension(pkg: String): UserExtension? = state.extensions.firstOrNull { it.pkg == pkg }
}

fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** بصمات SHA-256 لشهادات توقيع APK كما يعلنها Mihon (signingKeyFingerprint). */
@Suppress("DEPRECATION")
fun apkSignerFingerprints(context: Context, apk: File): Set<String> {
    val pm = context.packageManager
    val certs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val info = pm.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES) ?: return emptySet()
        val signing = info.signingInfo ?: return emptySet()
        if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory
    } else {
        pm.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNATURES)?.signatures
    } ?: return emptySet()
    return certs.map { sha256Hex(it.toByteArray()) }.toSet()
}
