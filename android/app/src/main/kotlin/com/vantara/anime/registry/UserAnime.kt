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
/** Each APK can expose multiple separately addressable anime/cinema sources. */
@Serializable
data class UserAnimeSource(val id: String, val name: String, val lang: String, val baseUrl: String)

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
    /** Missing on historical installations; those keep their original single-source identity. */
    val sources: List<UserAnimeSource> = emptyList(),
) {
    val id: String get() = "user-" + pkg.substringAfterLast('.').ifEmpty { pkg }

    fun entry(): SourceEntry = entries().first()

    fun entries(): List<SourceEntry> {
        val preferred = sourceName?.let { target -> sources.firstOrNull { it.name == target } }
        val ordered = if (sources.isEmpty()) emptyList() else
            listOf(preferred ?: sources.first()) + sources.filter { it.id != (preferred ?: sources.first()).id }
        if (ordered.isEmpty()) return listOf(SourceEntry(
            id = id, name = name, lang = "ar", priority = 40, content = content,
            extension = ExtensionRef(pkg = pkg, apk = apkUrl, sha256 = sha256, version = version, sourceName = sourceName),
            domains = Domains(current = baseUrl),
        ))
        return ordered.mapIndexed { index, source ->
            SourceEntry(
                // First source retains its old ID so history/progress keep working.
                id = if (index == 0) id else "${id}#${source.id}",
                name = source.name,
                lang = source.lang,
                priority = 40,
                content = content,
                extension = ExtensionRef(pkg = pkg, apk = apkUrl, sha256 = sha256, version = version,
                    sourceName = source.name, sourceId = source.id),
                domains = Domains(current = source.baseUrl.ifBlank { baseUrl }),
            )
        }
    }
}

@Serializable
data class UserAnimeState(val repos: List<UserRepo> = emptyList(), val extensions: List<UserAnimeExtension> = emptyList())

class UserAnimeStore(private val file: File) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    @Volatile var state: UserAnimeState = com.vantara.plugins.readExtensionState(file)?.let {
        try { json.decodeFromString<UserAnimeState>(it) }
        catch (error: Exception) { throw IllegalStateException("EXTENSION_STATE_CORRUPT: ${file.name}", error) }
    } ?: UserAnimeState()
        private set

    @Synchronized fun update(change: (UserAnimeState) -> UserAnimeState): UserAnimeState {
        val next = change(state)
        com.vantara.plugins.writeExtensionState(file, json.encodeToString(UserAnimeState.serializer(), next))
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
