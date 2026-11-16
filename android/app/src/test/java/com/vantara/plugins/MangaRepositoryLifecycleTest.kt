package com.vantara.plugins

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

/** Real private state files and delayed operations; these are lifecycle tests, not source-health evidence. */
class MangaRepositoryLifecycleTest {
    private val repo = UserRepo("https://repo.example", "Repo", "a".repeat(64))
    private val publication = Any()
    private fun extension(hash: Char = 'b') = UserExtension(repo.url, "Manga", "example.manga",
        "${repo.url}/source.apk", hash.toString().repeat(64), "1.6.2", 1.6, "ar", false,
        listOf(UserSource("42", "Manga", "ar")), aliases = mapOf("41" to "42"), versionCode = 2)
    private fun temporary(block: (File) -> Unit) {
        val dir = Files.createTempDirectory("manga-lifecycle").toFile()
        try { block(File(dir, "state.json")) } finally { dir.deleteRecursively() }
    }
    private fun store(file: File, installed: Boolean = true) = UserExtensionStore(file).also { store ->
        store.update { UserExtensionState(repos = listOf(repo), extensions = if (installed) listOf(extension()) else emptyList()) }
    }

    @Test fun delayedUpdateCannotReviveUninstallFromAnotherBridge() = temporary { file ->
        val first = store(file)
        val staged = CountDownLatch(1)
        val finish = CountDownLatch(1)
        val pool = Executors.newSingleThreadExecutor()
        val published = mutableListOf<List<String>>()
        val archive = File(file.parentFile, "installed.apk").apply { writeText("existing archive") }
        try {
            val late = pool.submit<Throwable?> {
                val token = first.beginInstall(extension().pkg, repo.url)
                staged.countDown()
                check(finish.await(5, TimeUnit.SECONDS))
                runCatching { first.commitInstall(token, extension('c'), publication) { state ->
                    published += state.extensions.map { it.sha256 }
                } }.exceptionOrNull()
            }
            assertTrue(staged.await(5, TimeUnit.SECONDS))
            UserExtensionStore(file).uninstall(extension().pkg, publication, { state ->
                published += state.extensions.map { it.sha256 }
            }, { assertTrue(archive.delete()) })
            finish.countDown()
            assertEquals("MANGA_PACKAGE_CHANGED", late.get(5, TimeUnit.SECONDS)?.message)
            assertEquals(listOf(emptyList<String>()), published)
            assertTrue(UserExtensionStore(file).state.extensions.isEmpty())
            assertFalse(archive.exists())
        } finally { finish.countDown(); pool.shutdownNow() }
    }

    @Test fun uninstallAlsoRevokesAFirstInstallWithoutAnInstalledRecord() = temporary { file ->
        val store = store(file, installed = false)
        val token = store.beginInstall(extension().pkg, repo.url)
        store.uninstall(extension().pkg, publication, {}, {})
        assertThrows(IllegalStateException::class.java) { store.commitInstall(token, extension(), publication) {} }
        assertTrue(UserExtensionStore(file).state.extensions.isEmpty())
    }

    @Test fun uninstallAndIdenticalReinstallStillRevokeAnOlderToken() = temporary { file ->
        val store = store(file)
        val stale = store.beginInstall(extension().pkg, repo.url)
        store.uninstall(extension().pkg, publication, {}, {})
        val fresh = store.beginInstall(extension().pkg, repo.url)
        store.commitInstall(fresh, extension(), publication) {}
        assertThrows(IllegalStateException::class.java) { store.commitInstall(stale, extension('c'), publication) {} }
        assertEquals(extension(), UserExtensionStore(file).state.extensions.single())
    }

    @Test fun firstCommittedUpdateRejectsAnotherOlderSnapshot() = temporary { file ->
        val store = store(file)
        val first = store.beginInstall(extension().pkg, repo.url)
        val second = store.beginInstall(extension().pkg, repo.url)
        store.commitInstall(first, extension('c'), publication) {}
        assertThrows(IllegalStateException::class.java) { store.commitInstall(second, extension('d'), publication) {} }
        assertEquals(extension('c'), UserExtensionStore(file).state.extensions.single())
    }

    @Test fun sameVersionExplicitReinstallRevokesAnOlderStagedUpdate() = temporary { file ->
        val store = store(file)
        val older = store.beginInstall(extension().pkg, repo.url)
        val reinstall = store.beginInstall(extension().pkg, repo.url)
        store.commitInstall(reinstall, extension(), publication) {}
        val failure = assertThrows(IllegalStateException::class.java) {
            store.commitInstall(older, extension('c'), publication) {}
        }
        assertEquals("MANGA_PACKAGE_CHANGED", failure.message)
        assertEquals(extension(), UserExtensionStore(file).state.extensions.single())
    }

    @Test fun repositoryUnlinkRetainsInstalledDataButRejectsLateUpdate() = temporary { file ->
        val store = store(file)
        val token = store.beginInstall(extension().pkg, repo.url)
        UserExtensionStore(file).unlinkRepository(repo.url)
        val failure = assertThrows(IllegalStateException::class.java) { store.commitInstall(token, extension('c'), publication) {} }
        assertEquals("MANGA_REPOSITORY_CHANGED", failure.message)
        assertEquals(extension(), UserExtensionStore(file).state.extensions.single())
    }

    @Test fun repositoryUnlinkAndIdenticalReaddRejectLateFirstInstall() = temporary { file ->
        val store = store(file, installed = false)
        val token = store.beginInstall(extension().pkg, repo.url)
        store.unlinkRepository(repo.url)
        store.registerRepository(repo)
        assertThrows(IllegalStateException::class.java) { store.commitInstall(token, extension(), publication) {} }
        assertTrue(UserExtensionStore(file).state.extensions.isEmpty())
    }

    @Test fun failedValidationCannotWriteOrPublish() = temporary { file ->
        val store = store(file)
        val token = store.beginInstall(extension().pkg, repo.url)
        val before = file.readBytes()
        var published = false
        assertThrows(IllegalStateException::class.java) {
            store.commitInstall(token, extension('c'), publication, validate = { error("ID_COLLISION") }) { published = true }
        }
        assertFalse(published)
        assertArrayEquals(before, file.readBytes())
    }

    @Test fun failedWriteCannotPublishOrEraseAndValidationPublicationShareOneMonitor() = temporary { file ->
        val store = store(file)
        val token = store.beginInstall(extension().pkg, repo.url)
        val blocker = File(file.path + ".new").apply { mkdir() }
        File(blocker, "keep").writeText("block atomic rename")
        var published = false
        var erased = false
        assertThrows(Exception::class.java) {
            store.commitInstall(token, extension('c'), publication,
                validate = { assertTrue(Thread.holdsLock(publication)) }) { published = true }
        }
        assertThrows(Exception::class.java) { store.uninstall(extension().pkg, publication, { published = true }, { erased = true }) }
        assertFalse(published)
        assertFalse(erased)
        assertEquals(extension(), store.state.extensions.single())
        blocker.deleteRecursively()
        store.commitInstall(token, extension('c'), publication,
            validate = { assertTrue(Thread.holdsLock(publication)) }) { state ->
            assertTrue(Thread.holdsLock(publication))
            assertEquals(state, UserExtensionStore(file).state)
        }
    }

    @Test fun repositoryKeyReplacementCannotInvalidatePublisherTrustSilently() = temporary { file ->
        val store = store(file)
        val before = file.readBytes()
        assertThrows(IllegalStateException::class.java) { store.registerRepository(repo.copy(fingerprint = "c".repeat(64))) }
        assertArrayEquals(before, file.readBytes())
        assertEquals(extension(), store.state.extensions.single())
    }
}
