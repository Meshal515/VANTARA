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
    /** Zero means an old saved record/repository did not declare an Android version code. */
    val versionCode: Long = 0,
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
    private val packageRevisions = mutableMapOf<String, Long>()
    private val repositoryRevisions = mutableMapOf<String, Long>()

    class InstallToken internal constructor(
        internal val owner: UserAnimeStore,
        val pkg: String,
        val repository: UserRepo,
        val previous: UserAnimeExtension?,
        internal val packageRevision: Long,
        internal val repositoryRevision: Long,
    )

    @Volatile var state: UserAnimeState = storage.read(UserAnimeState()) {
        json.decodeFromString<UserAnimeState>(it)
    }
        private set

    @Synchronized fun update(change: (UserAnimeState) -> UserAnimeState): UserAnimeState {
        val next = change(state)
        storage.write(json.encodeToString(UserAnimeState.serializer(), next))
        val beforePackages = state.extensions.associateBy { it.pkg }
        val afterPackages = next.extensions.associateBy { it.pkg }
        for (pkg in beforePackages.keys + afterPackages.keys) {
            if (beforePackages[pkg] != afterPackages[pkg]) packageRevisions[pkg] = (packageRevisions[pkg] ?: 0) + 1
        }
        val beforeRepos = state.repos.associateBy { it.url }
        val afterRepos = next.repos.associateBy { it.url }
        for (url in beforeRepos.keys + afterRepos.keys) {
            if (beforeRepos[url] != afterRepos[url]) repositoryRevisions[url] = (repositoryRevisions[url] ?: 0) + 1
        }
        state = next
        return next
    }

    /** Re-adding/refreshing a bookmark is not authorization to replace a pinned publisher identity. */
    @Synchronized fun registerRepository(repo: UserRepo): UserAnimeState {
        val pinned = state.repos.singleOrNull { it.url == repo.url }
        check(pinned == null || pinned.fingerprint.equals(repo.fingerprint, ignoreCase = true)) {
            "ANIYOMI_REPOSITORY_KEY_CHANGED"
        }
        return update { it.copy(repos = it.repos.filter { old -> old.url != repo.url } + repo) }
    }

    @Synchronized fun beginInstall(pkg: String, repoUrl: String): InstallToken {
        val repo = state.repos.singleOrNull { it.url == repoUrl }
            ?: error("ANIYOMI_REPOSITORY_CHANGED")
        return InstallToken(this, pkg, repo, state.extensions.singleOrNull { it.pkg == pkg },
            packageRevisions[pkg] ?: 0, repositoryRevisions[repoUrl] ?: 0)
    }

    /** No network under the monitor. Lock order: store -> engine; engine never reads this store. */
    @Synchronized fun commitInstall(token: InstallToken, user: UserAnimeExtension,
        publish: (UserAnimeState) -> Unit): UserAnimeState {
        check(token.owner === this && user.pkg == token.pkg && user.repoUrl == token.repository.url) { "ANIYOMI_PACKAGE_CHANGED" }
        check((packageRevisions[token.pkg] ?: 0) == token.packageRevision &&
            state.extensions.singleOrNull { it.pkg == token.pkg } == token.previous) { "ANIYOMI_PACKAGE_CHANGED" }
        check((repositoryRevisions[token.repository.url] ?: 0) == token.repositoryRevision &&
            state.repos.singleOrNull { it.url == token.repository.url } == token.repository) { "ANIYOMI_REPOSITORY_CHANGED" }
        val next = update { it.copy(extensions = it.extensions.filter { item -> item.pkg != user.pkg } + user) }
        publish(next)
        return next
    }

    @Synchronized fun uninstall(pkg: String, publish: (UserAnimeState) -> Unit, erase: () -> Unit): UserAnimeState {
        val next = update { it.copy(extensions = it.extensions.filter { item -> item.pkg != pkg }) }
        // Also revoke a first install that started while this package had no active record.
        packageRevisions[pkg] = (packageRevisions[pkg] ?: 0) + 1
        publish(next)
        erase()
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
