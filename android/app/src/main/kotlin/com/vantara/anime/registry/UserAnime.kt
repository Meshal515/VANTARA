package com.vantara.anime.registry

import com.vantara.plugins.UserRepo
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/**
 * إضافات Aniyomi التي ثبّتها المستخدم من مستودعاته. تدخل بيان المحرك كأي مصدر مشحون
 * (SourceEntry بإضافة وبصمة مثبّتة)، فتعمل في البحث والحلقات والسيرفرات والصحة بلا
 * مسار خاص. القسم (أنمي/أفلام) يختاره المستخدم لأن المستودع لا يفرّق بينهما.
 */
@Serializable
data class UserAnimeExtension(
    val repoUrl: String,
    val name: String,
    val pkg: String,
    val apkUrl: String,
    val sha256: String,
    val version: String,
    /** anime | cinema */
    val content: String,
    val sourceName: String? = null,
    val baseUrl: String,
    /** Null on old persisted records, so historical library IDs remain unchanged. */
    val stableId: String? = null,
    val sourceLang: String = "ar",
) {
    val id: String get() = stableId ?: ("user-" + pkg.substringAfterLast('.').ifEmpty { pkg })

    fun entry(): SourceEntry = SourceEntry(
        id = id,
        name = name,
        lang = sourceLang,
        priority = 40,
        content = content,
        extension = ExtensionRef(pkg = pkg, apk = apkUrl, sha256 = sha256, version = version, sourceName = sourceName),
        domains = Domains(current = baseUrl),
    )
}

@Serializable
data class UserAnimeState(val repos: List<UserRepo> = emptyList(), val extensions: List<UserAnimeExtension> = emptyList())

class UserAnimeStore(private val file: File) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    private val atomic = android.util.AtomicFile(file)

    @Volatile var state: UserAnimeState = if (!file.exists() && !File(file.path + ".bak").exists()) UserAnimeState() else
        runCatching {
            json.decodeFromString<UserAnimeState>(atomic.openRead().bufferedReader(Charsets.UTF_8).use { it.readText() })
        }.getOrElse { throw IllegalStateException("ANIME_EXTENSION_STATE_CORRUPTED: cannot silently reset installed extensions", it) }
        private set

    @Synchronized fun update(change: (UserAnimeState) -> UserAnimeState): UserAnimeState {
        val next = change(state)
        val bytes = json.encodeToString(UserAnimeState.serializer(), next).toByteArray(Charsets.UTF_8)
        file.parentFile?.mkdirs()
        val stream = atomic.startWrite()
        try {
            stream.write(bytes)
            atomic.finishWrite(stream)
        } catch (error: Throwable) {
            atomic.failWrite(stream)
            throw error
        }
        state = next
        return next
    }
}

/** البيان المشحون + إضافات المستخدم، بلا تكرار حزمة أو معرّف (المشحون يفوز). */
fun mergeUserSources(base: Manifest, user: List<SourceEntry>): Manifest {
    val ids = base.sources.map { it.id }.toSet()
    val pkgs = base.sources.mapNotNull { it.extension?.pkg }.toSet()
    val extra = user.filter { it.id !in ids && it.extension?.pkg !in pkgs }
    return if (extra.isEmpty()) base else base.copy(sources = base.sources + extra)
}
