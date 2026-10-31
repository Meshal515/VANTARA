package com.vantara.anime.registry

import com.vantara.plugins.ExtensionStateFile
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
data class InstalledAnimeSource(
    val sourceId: String,
    val id: String,
    val name: String,
    val lang: String,
    val baseUrl: String,
)

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
    val primarySourceId: String? = null,
    val additionalSources: List<InstalledAnimeSource> = emptyList(),
) {
    val id: String get() = stableId ?: ("user-" + pkg.substringAfterLast('.').ifEmpty { pkg })

    fun entry(): SourceEntry = SourceEntry(
        id = id,
        name = sourceName ?: name,
        lang = sourceLang,
        priority = 40,
        content = content,
        extension = ExtensionRef(pkg = pkg, apk = apkUrl, sha256 = sha256, version = version, sourceName = sourceName, sourceId = primarySourceId),
        domains = Domains(current = baseUrl),
    )

    /** All sources from a signed APK are addressable, including non-Arabic ones. */
    fun entries(): List<SourceEntry> = listOf(entry()) + additionalSources.map { source ->
        SourceEntry(
            id = source.id,
            name = source.name,
            lang = source.lang,
            priority = 40,
            content = content,
            extension = ExtensionRef(pkg = pkg, apk = apkUrl, sha256 = sha256,
                version = version, sourceName = source.name, sourceId = source.sourceId),
            domains = Domains(current = source.baseUrl),
        )
    }
}

@Serializable
data class UserAnimeState(val repos: List<UserRepo> = emptyList(), val extensions: List<UserAnimeExtension> = emptyList())

class UserAnimeStore(private val file: File) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    private val storage = ExtensionStateFile(file)

    @Volatile var state: UserAnimeState = storage.read(UserAnimeState()) {
        json.decodeFromString<UserAnimeState>(it)
    }
        private set

    @Synchronized fun update(change: (UserAnimeState) -> UserAnimeState): UserAnimeState {
        val next = change(state)
        storage.write(json.encodeToString(UserAnimeState.serializer(), next))
        state = next
        return next
    }
}

/** البيان المشحون + إضافات المستخدم، بلا تكرار حزمة أو معرّف (المشحون يفوز). */
fun mergeUserSources(base: Manifest, user: List<SourceEntry>): Manifest {
    val ids = base.sources.map { it.id }.toSet()
    val pkgs = base.sources.mapNotNull { it.extension?.pkg }.toSet()
    val extra = user.filter { it.id !in ids && it.extension?.pkg !in pkgs }
        .distinctBy { it.id }
    return if (extra.isEmpty()) base else base.copy(sources = base.sources + extra)
}
