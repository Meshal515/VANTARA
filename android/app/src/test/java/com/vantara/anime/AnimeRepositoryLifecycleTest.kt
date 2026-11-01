package com.vantara.anime

import com.vantara.anime.bridge.initializeAnimeUserSources
import com.vantara.anime.registry.UserAnimeExtension
import com.vantara.anime.registry.UserAnimeState
import com.vantara.anime.registry.UserAnimeStore
import com.vantara.plugins.UserRepo
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class AnimeRepositoryLifecycleTest {
    private val repo = UserRepo("https://repo.example", "Repo", "a".repeat(64))
    private fun extension(hash: Char = 'b') = UserAnimeExtension(
        repo.url, "Anime", "dev.example.anime", "${repo.url}/anime.apk", hash.toString().repeat(64),
        "14.26", "anime", baseUrl = "https://source.example", stableId = "user-dev.example.anime",
    )
    private fun <T> temporary(block: (File) -> T): T {
        val directory = Files.createTempDirectory("anime-lifecycle-").toFile()
        try { return block(File(directory, "user-repos.json")) } finally { directory.deleteRecursively() }
    }
    private fun store(file: File) = UserAnimeStore(file).also { s ->
        s.update { UserAnimeState(repos = listOf(repo), extensions = listOf(extension())) }
    }

    @Test fun `readding a repository cannot silently replace its pinned signing key`() = temporary { file ->
        val s = store(file)
        val before = file.readBytes()
        val changed = repo.copy(fingerprint = "c".repeat(64))
        val error = assertThrows(IllegalStateException::class.java) { s.registerRepository(changed) }
        assertEquals("ANIYOMI_REPOSITORY_KEY_CHANGED", error.message)
        assertArrayEquals(before, file.readBytes())
        assertEquals(repo, UserAnimeStore(file).state.repos.single())
        assertEquals(extension(), s.state.extensions.single())
    }
    @Test fun `same repository signing key permits metadata refresh without changing installations`() = temporary { file ->
        val s = store(file)
        val refreshed = repo.copy(name = "Publisher renamed", iconUrl = "https://repo.example/icon.png")
        s.registerRepository(refreshed)
        assertEquals(refreshed, UserAnimeStore(file).state.repos.single())
        assertEquals(extension(), s.state.extensions.single())
    }

    @Test fun `corrupt startup keeps original bytes and does not publish empty sources`() = temporary { file ->
        val corrupt = "{broken-installed-state".toByteArray()
        file.writeBytes(corrupt)
        var published = false
        val failure = initializeAnimeUserSources(runCatching { UserAnimeStore(file) }) { published = true }
        assertNotNull(failure)
        assertEquals("EXTENSION_STATE_CORRUPTED", failure!!.message)
        assertFalse(published)
        assertArrayEquals(corrupt, file.readBytes())
        assertThrows(IllegalStateException::class.java) { UserAnimeStore(file) }
        Unit
    }

    @Test fun `uninstall during staged update rejects late commit and leaves durable state removed`() = temporary { file ->
        val s = store(file)
        val staged = CountDownLatch(1)
        val finishProbe = CountDownLatch(1)
        val pool = Executors.newSingleThreadExecutor()
        val published = mutableListOf<List<String>>()
        try {
            val update = pool.submit<Throwable?> {
                val token = s.beginInstall(extension().pkg, repo.url)
                staged.countDown()
                check(finishProbe.await(5, TimeUnit.SECONDS))
                runCatching { s.commitInstall(token, extension('c')) { state ->
                    synchronized(published) { published += state.extensions.map { it.sha256 } }
                } }.exceptionOrNull()
            }
            assertTrue(staged.await(5, TimeUnit.SECONDS))
            s.uninstall(extension().pkg, { state -> synchronized(published) { published += state.extensions.map { it.sha256 } } }, {})
            finishProbe.countDown()
            assertEquals("ANIYOMI_PACKAGE_CHANGED", update.get(5, TimeUnit.SECONDS)?.message)
            assertTrue(s.state.extensions.isEmpty())
            assertTrue(UserAnimeStore(file).state.extensions.isEmpty())
            assertEquals(listOf(emptyList<String>()), published)
        } finally { finishProbe.countDown(); pool.shutdownNow() }
    }

    @Test fun `first committed update invalidates another staged snapshot`() = temporary { file ->
        val s = store(file)
        val first = s.beginInstall(extension().pkg, repo.url)
        val second = s.beginInstall(extension().pkg, repo.url)
        s.commitInstall(first, extension('c')) {}
        val failure = assertThrows(IllegalStateException::class.java) { s.commitInstall(second, extension('d')) {} }
        assertEquals("ANIYOMI_PACKAGE_CHANGED", failure.message)
        assertEquals(extension('c'), UserAnimeStore(file).state.extensions.single())
    }

    @Test fun `removed repository invalidates staged installation without erasing existing extension`() = temporary { file ->
        val s = store(file)
        val token = s.beginInstall(extension().pkg, repo.url)
        s.update { it.copy(repos = emptyList()) }
        assertThrows(IllegalStateException::class.java) { s.commitInstall(token, extension('c')) {} }
        assertEquals(extension(), UserAnimeStore(file).state.extensions.single())
    }

    @Test fun `failed durable write cannot publish or erase installed archive`() = temporary { file ->
        val s = store(file)
        val token = s.beginInstall(extension().pkg, repo.url)
        File(file.path + ".new").mkdir()
        File(file.path + ".new/blocker").writeText("keep write failure reproducible")
        var published = false
        var erased = false
        assertThrows(Exception::class.java) { s.commitInstall(token, extension('c')) { published = true } }
        assertThrows(Exception::class.java) { s.uninstall(extension().pkg, { published = true }, { erased = true }) }
        assertFalse(published)
        assertFalse(erased)
        assertEquals(extension(), s.state.extensions.single())
    }
}
