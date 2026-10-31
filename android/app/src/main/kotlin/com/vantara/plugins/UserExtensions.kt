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
import kotlinx.serialization.json.longOrNull
import java.io.File
import java.net.URI
import java.security.MessageDigest

/**
 * مستودعات إضافات المانجا التي يضيفها المستخدم (صيغة Mihon/Keiyoushi):
 *
 *   <base>/repo.json        { meta: { name, signingKeyFingerprint }, index_v2?: رابط index.pb }
 *   index.pb (v2، Keiyoushi اليوم): protobuf مضغوط gzip فيه الإضافات ورابط APK كل منها
 *   <base>/index.min.json   (v1) [{ name, pkg, apk, lang, version, nsfw, sources: [{ id, name, lang }] }]
 *   <base>/apk/<apk>        (v1)
 *
 * الإضافة كود يعمل داخل التطبيق، فالثقة بالمستودع لا بالملف: كل APK يجب أن يكون
 * موقَّعًا بالمفتاح الذي أعلنه المستودع (كما في Mihon)، وبصمته SHA-256 تُثبَّت عند
 * التثبيت فلا يُحمَّل بعدها ملف تغيّر. إضافات الأنمي (Aniyomi) لها واجهة أخرى.
 */
object RepoIndex {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val SHA256 = Regex("^[0-9a-f]{64}$")

    /** `extensionListUrl` (الحقل 102): قائمة الإضافات في ملف مستقل؛ تُتبع مرة واحدة لا أكثر. */
    data class Meta(val name: String, val fingerprint: String, val iconUrl: String? = null, val extensionListUrl: String? = null)
    /** اسم حزمة Android: مقاطع تبدأ بحرف، فلا «..» ولا فواصل مسار تصل لمسار ملف. */
    val PKG = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")
    data class Source(val id: String, val name: String, val lang: String, val baseUrl: String = "")
    data class Extension(
        val name: String, val pkg: String, val apkUrl: String, val lang: String, val version: String,
        val lib: Double, val nsfw: Boolean, val sources: List<Source>, val iconUrl: String? = null,
        /** رقم الإصدار كما يعلنه الفهرس (منع الرجوع لإصدار أقدم)؛ 0 = غير معلن فلا مقارنة. */
        val versionCode: Long = 0,
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

    /** رابط index.pb إن أعلنه repo.json (HTTPS فقط)، وإلا null فيُقرأ index.min.json. */
    fun indexV2(repoJson: String): String? {
        val url = (json.parseToJsonElement(repoJson).jsonObject["index_v2"])?.jsonPrimitive?.contentOrNull ?: return null
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        return url.takeIf { uri.scheme.equals("https", ignoreCase = true) && uri.host != null && uri.rawUserInfo == null }
    }

    fun parseMeta(text: String): Meta {
        val meta = json.parseToJsonElement(text).jsonObject["meta"]?.jsonObject ?: error("repo.json بلا meta")
        val name = meta["name"]?.jsonPrimitive?.contentOrNull?.take(80)?.ifBlank { null } ?: error("المستودع بلا اسم")
        val fingerprint = meta["signingKeyFingerprint"]?.jsonPrimitive?.contentOrNull?.lowercase()?.replace(":", "")
        require(fingerprint != null && SHA256.matches(fingerprint)) { "المستودع لا يعلن مفتاح توقيع؛ لا نشغّل كودًا بلا توقيع معروف" }
        return Meta(name, fingerprint, declaredIcon(meta))
    }

    /** Only an actual HTTPS image reference supplied by the repository; no guessed paths. */
    private fun declaredIcon(value: JsonObject): String? = sequenceOf("iconUrl", "logo", "icon")
        .mapNotNull { key -> (value[key] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull }
        .firstOrNull { raw ->
            raw.length <= 2048 && runCatching {
                val uri = URI(raw)
                uri.scheme.equals("https", true) && uri.host != null && uri.rawUserInfo == null && uri.port == -1
            }.getOrDefault(false)
        }

    fun parseIndex(text: String, base: String): List<Extension> {
        val list = json.parseToJsonElement(text) as? JsonArray ?: error("index.min.json ليس قائمة")
        require(list.size <= 5000) { "المستودع أكبر من الحد" }
        return list.mapNotNull { element ->
            val o = element as? JsonObject ?: return@mapNotNull null
            val pkg = o["pkg"]?.jsonPrimitive?.contentOrNull?.takeIf { PKG.matches(it) } ?: return@mapNotNull null
            val apk = o["apk"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            if (!Regex("^[A-Za-z0-9._-]+\\.apk$").matches(apk) || !Regex("^[A-Za-z0-9_.]+$").matches(pkg)) return@mapNotNull null
            val version = o["version"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val lib = version.split('.').take(2).joinToString(".").toDoubleOrNull() ?: return@mapNotNull null
            val sources = (o["sources"] as? JsonArray).orEmpty().mapNotNull { s ->
                val so = s as? JsonObject ?: return@mapNotNull null
                val id = so["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                Source(id, so["name"]?.jsonPrimitive?.contentOrNull ?: pkg, so["lang"]?.jsonPrimitive?.contentOrNull ?: "", so["baseUrl"]?.jsonPrimitive?.contentOrNull ?: "")
            }
            Extension(
                name = (o["name"]?.jsonPrimitive?.contentOrNull ?: pkg).removePrefix("Tachiyomi: ").removePrefix("Aniyomi: "),
                pkg = pkg, apkUrl = "$base/apk/$apk", lang = o["lang"]?.jsonPrimitive?.contentOrNull ?: "",
                version = version, lib = lib, nsfw = (o["nsfw"]?.jsonPrimitive?.intOrNull ?: 0) == 1, sources = sources, iconUrl = declaredIcon(o),
                versionCode = o["code"]?.jsonPrimitive?.longOrNull?.takeIf { it > 0 } ?: 0,
            )
        }
    }

    /**
     * index.pb (v2): Index { 1 name, 3 signingKeyFingerprint, 101 { 1 Extension... } }
     * Extension { 1 name, 2 pkg, 3 { 1 apkUrl }, 4 lib, 6 versionName, 7 contentWarning (1 آمن، 2 مختلط، 3 للكبار),
     *             8 Source { 1 id, 2 name, 3 lang } }
     * يُفك يدويًا (حقول قليلة ثابتة) بلا مخطط مولَّد.
     */
    fun parseIndexV2(raw: ByteArray): Pair<Meta, List<Extension>> {
        val top = Pb(unpack(raw)).fields()
        val name = top.text(1)?.take(80)?.ifBlank { null } ?: error("فهرس المستودع بلا اسم")
        val fingerprint = top.text(3)?.lowercase()?.replace(":", "")
        require(fingerprint != null && SHA256.matches(fingerprint)) { "المستودع لا يعلن مفتاح توقيع؛ لا نشغّل كودًا بلا توقيع معروف" }
        val listUrl = top.text(102)?.takeIf { it.startsWith("https://") }
        return Meta(name, fingerprint, extensionListUrl = listUrl) to entries(top.all(101).flatMap { Pb(it).fields().all(1) })
    }

    /** ملف `extensionListUrl`: ExtensionList { 1 Extension... } بلا اسم ولا مفتاح (يُحكم بمفتاح المستودع). */
    fun parseExtensionList(raw: ByteArray): List<Extension> = entries(Pb(unpack(raw)).fields().all(1))

    private fun unpack(raw: ByteArray) = if (raw.size > 2 && raw[0] == 0x1f.toByte() && raw[1] == 0x8b.toByte()) gunzip(raw, 32 * 1024 * 1024) else raw

    private fun entries(list: List<ByteArray>): List<Extension> {
        require(list.size <= 5000) { "المستودع أكبر من الحد" }
        return list.mapNotNull { entry ->
            val e = Pb(entry).fields()
            val pkg = e.text(2)?.takeIf { PKG.matches(it) } ?: return@mapNotNull null
            val apkUrl = e.bytes(3)?.let { Pb(it).fields().text(1) }?.takeIf { it.startsWith("https://") } ?: return@mapNotNull null
            val version = e.text(6) ?: return@mapNotNull null
            val lib = e.text(4)?.toDoubleOrNull() ?: version.split('.').take(2).joinToString(".").toDoubleOrNull() ?: return@mapNotNull null
            val sources = e.all(8).mapNotNull { s ->
                val so = Pb(s).fields()
                val id = so.varint(1)?.toULong()?.toLong()?.toString() ?: return@mapNotNull null
                Source(id, so.text(2) ?: pkg, so.text(3) ?: "", so.text(4) ?: "")
            }
            val langs = sources.map { it.lang }.distinct()
            Extension(
                name = e.text(1) ?: pkg, pkg = pkg, apkUrl = apkUrl, lang = langs.singleOrNull() ?: "all",
                version = version, lib = lib, nsfw = e.varint(7) == 3L, sources = sources,
                versionCode = e.varint(5)?.takeIf { it > 0 } ?: 0,
            )
        }
    }

    private fun gunzip(raw: ByteArray, limit: Int): ByteArray =
        java.util.zip.GZIPInputStream(raw.inputStream()).use { input ->
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
                require(out.size() <= limit) { "فهرس المستودع أكبر من الحد" }
            }
            out.toByteArray()
        }

    /** قارئ protobuf صغير: حقول varint ونصوص/رسائل فقط (ما يحتاجه الفهرس). */
    private class Pb(private val b: ByteArray) {
        class Fields(private val map: Map<Int, List<Any>>) {
            fun all(f: Int): List<ByteArray> = map[f].orEmpty().filterIsInstance<ByteArray>()
            fun bytes(f: Int): ByteArray? = all(f).firstOrNull()
            fun text(f: Int): String? = bytes(f)?.toString(Charsets.UTF_8)
            fun varint(f: Int): Long? = map[f].orEmpty().filterIsInstance<Long>().firstOrNull()
        }
        private var i = 0
        private fun varint(): Long {
            var r = 0L; var shift = 0
            while (true) {
                require(i < b.size && shift < 64) { "فهرس تالف" }
                val c = b[i++].toInt() and 0xff
                r = r or ((c and 0x7f).toLong() shl shift)
                if (c < 0x80) return r
                shift += 7
            }
        }
        fun fields(): Fields {
            val map = HashMap<Int, MutableList<Any>>()
            while (i < b.size) {
                val key = varint()
                val field = (key ushr 3).toInt()
                when ((key and 7).toInt()) {
                    0 -> map.getOrPut(field) { mutableListOf() }.add(varint())
                    2 -> {
                        val len = varint().toInt()
                        require(len >= 0 && i + len <= b.size) { "فهرس تالف" }
                        map.getOrPut(field) { mutableListOf() }.add(b.copyOfRange(i, i + len)); i += len
                    }
                    1 -> i += 8
                    5 -> i += 4
                    else -> error("فهرس تالف")
                }
            }
            return Fields(map)
        }
    }

    /** المصادر التي تظهر في التطبيق: العربية إن وُجدت، وإلا مصادر لغة الإضافة. */
    fun visibleSources(ext: Extension): List<Source> =
        ext.sources.filter { it.lang.equals("ar", ignoreCase = true) }.ifEmpty {
            ext.sources.filter { it.lang.equals(ext.lang, ignoreCase = true) }.ifEmpty { ext.sources.take(1) }
        }
}

@Serializable
data class UserRepo(val url: String, val name: String, val fingerprint: String, val iconUrl: String? = null)

@Serializable
data class UserSource(val id: String, val name: String, val lang: String)

/** إصدار سابق محفوظ في مخزن الجهاز (Last Known Good): يُرجع إليه إن تعطّل الحالي. */
@Serializable
data class UserVersion(val apkUrl: String, val sha256: String, val versionName: String, val lib: Double, val sources: List<UserSource>)

@Serializable
data class UserExtension(
    val repoUrl: String, val name: String, val pkg: String, val apkUrl: String, val sha256: String,
    val versionName: String, val lib: Double, val lang: String, val nsfw: Boolean, val sources: List<UserSource>,
    val previous: UserVersion? = null,
    /**
     * رقم الإصدار المثبت كما أعلنه الفهرس؛ 0 في سجلات قبل حفظه فلا مقارنة. لا يُستنتج من versionName:
     * Keiyoushi غيّرت مخططه (1.6.0 رقمه 106000، و1.4.6 كان 6).
     */
    val versionCode: Long = 0,
    /**
     * معرّفات مصادر قديمة ← الحالية. المكتبة والتقدّم محفوظة بالمعرّف الذي أُضيف به المصدر
     * (`pkg#id`)، فإن غيّرت الإضافة معرّف مصدرها في تحديث بقيت مكتبتك تصل إليه (PERSISTENT_PLUGINS §3.2).
     */
    val aliases: Map<String, String> = emptyMap(),
) {
    fun spec(): SourceSpec = SourceSpec(
        label = name, pkg = pkg, expectedLib = lib, apkUrl = apkUrl, sha256 = sha256, versionName = versionName,
        warning = if (nsfw) ContentWarning.MIXED else ContentWarning.SAFE,
        arabicSourceIds = sources.map { it.id }.toSet(), arabicSourceNames = sources.map { it.name },
    )

    fun previousSpec(): SourceSpec? = previous?.let { p ->
        spec().copy(apkUrl = p.apkUrl, sha256 = p.sha256, versionName = p.versionName, expectedLib = p.lib,
            arabicSourceIds = p.sources.map { it.id }.toSet(), arabicSourceNames = p.sources.map { it.name })
    }

    fun asVersion() = UserVersion(apkUrl, sha256, versionName, lib, sources)


    /** معرّف المصدر الحالي لمعرّف محفوظ، باتباع سلسلة الترحيل (بحد، فلا حلقة تعلّق التحميل). */
    fun resolve(id: String): String {
        var at = id
        repeat(8) { if (sources.any { it.id == at }) return at; at = aliases[at] ?: return at }
        return at
    }

    /** يصير الإصدار [next] هو الحالي، ويبقى هذا آخر سليم قبله، وتُرحَّل معرّفات المصادر التي تغيّرت. */
    fun upgradedTo(next: UserExtension): UserExtension {
        val keepPrev = if (next.sha256.equals(sha256, ignoreCase = true)) previous else asVersion()
        return next.copy(previous = keepPrev, aliases = aliases + sourceAliases(sources, next.sources))
    }

    /** الرجوع لآخر سليم: يصير هو الحالي بمصادره، ومعرّفات الإصدار المتعطّل تُرحَّل إليه. */
    fun rolledBack(): UserExtension? = previous?.let { p ->
        copy(apkUrl = p.apkUrl, sha256 = p.sha256, versionName = p.versionName, lib = p.lib, sources = p.sources,
            previous = null, versionCode = 0, aliases = aliases + sourceAliases(sources, p.sources))
    }
}

/**
 * ترحيل معرّفات المصادر بين إصدارين: معرّف اختفى يُربط بمصدر جديد له الاسم واللغة نفسهما فقط إن كان
 * المطابق الوحيد. التطابق الغامض لا يُرحَّل تلقائيًا (Keiyoushi غيّرت معرّفات 53 حزمة، منها ar.mangahub).
 */
fun sourceAliases(from: List<UserSource>, to: List<UserSource>): Map<String, String> {
    val ids = to.map { it.id }.toSet()
    fun key(s: UserSource) = s.name.trim().lowercase() + "\u0000" + s.lang.trim().lowercase()
    val byKey = to.groupBy(::key)
    return from.filter { it.id !in ids }.mapNotNull { old ->
        byKey[key(old)]?.singleOrNull()?.let { old.id to it.id }
    }.toMap()
}

@Serializable
data class UserExtensionState(val repos: List<UserRepo> = emptyList(), val extensions: List<UserExtension> = emptyList())

/** الحالة في ملف خاص بالتطبيق؛ الكتابة ذرّية فلا يفسدها إغلاق مفاجئ. */
class UserExtensionStore(private val file: File) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val storage = ExtensionStateFile(file)

    @Volatile var state: UserExtensionState = storage.read(UserExtensionState()) {
        json.decodeFromString<UserExtensionState>(it)
    }
        private set

    @Synchronized fun update(change: (UserExtensionState) -> UserExtensionState): UserExtensionState {
        val next = change(state)
        storage.write(json.encodeToString(UserExtensionState.serializer(), next))
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

/**
 * قراءة المستودع وتنزيل إضافاته والتحقق من توقيعها: مشترك بين المانجا والأنمي.
 * إضافة لا يطابق توقيعها مفتاح المستودع لا تُرجع بايتاتها أبدًا.
 */
class RepoClient(private val context: Context, private val client: okhttp3.OkHttpClient) {
    fun fetchBytes(url: String, limit: Int): ByteArray =
        client.newCall(okhttp3.Request.Builder().url(url).build()).execute().use { res ->
            require(res.isSuccessful) { "تعذر الوصول (HTTP ${res.code})" }
            require(res.body.contentLength() <= limit) { "الملف أكبر من الحد" }
            res.body.bytes().also { require(it.size <= limit) { "الملف أكبر من الحد" } }
        }

    fun fetchText(url: String): String = String(fetchBytes(url, 8 * 1024 * 1024), Charsets.UTF_8)

    /** repo.json ثم فهرسه: index.pb (v2) إن أعلنه، وإلا index.min.json (v1). */
    fun read(base: String): Pair<RepoIndex.Meta, List<RepoIndex.Extension>> {
        val repoJson = fetchText("$base/repo.json")
        val declared = RepoIndex.parseMeta(repoJson)
        val v2 = RepoIndex.indexV2(repoJson)
        if (v2 != null) {
            val (meta, list) = RepoIndex.parseIndexV2(fetchBytes(v2, 16 * 1024 * 1024))
            require(declared.fingerprint == meta.fingerprint) { "مفتاح التوقيع في repo.json لا يطابق الفهرس" }
            // القائمة قد تكون في ملف مستقل (الحقل 102): تُتبع مرة واحدة فقط، فلا حلقة إعادة توجيه
            // بلا حد كما في Mihon، وبحد حجم. بدون هذا كان نقل Keiyoushi القائمة إليه يُظهر صفر إضافات
            val all = if (list.isEmpty() && meta.extensionListUrl != null) RepoIndex.parseExtensionList(fetchBytes(meta.extensionListUrl, 16 * 1024 * 1024)) else list
            return declared to all
        }
        return declared to RepoIndex.parseIndex(fetchText("$base/index.min.json"), base)
    }

    /** يقرأ المستودع ويتأكد أن مفتاحه لم يتغيّر منذ أضافه المستخدم. */
    fun readTrusted(repo: UserRepo): List<RepoIndex.Extension> {
        val (meta, list) = read(repo.url)
        require(meta.fingerprint == repo.fingerprint) { "مفتاح توقيع المستودع تغيّر منذ أضفته؛ أزله وأضفه من جديد إن كنت تثق به" }
        return list
    }

    /** يُنزّل APK ويرجع بايتاته فقط إن وقّعه مفتاح المستودع. */
    fun downloadSigned(url: String, fingerprint: String): ByteArray {
        val bytes = fetchBytes(url, 40 * 1024 * 1024)
        val probe = File(context.cacheDir, "ext-verify-${System.nanoTime()}.apk")
        try {
            probe.writeBytes(bytes)
            require(fingerprint in apkSignerFingerprints(context, probe)) { "توقيع الإضافة لا يطابق مفتاح المستودع؛ لم تُثبَّت" }
        } finally { probe.delete() }
        return bytes
    }
}
