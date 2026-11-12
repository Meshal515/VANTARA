package com.vantara.plugins

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class UserRepositoryRemovalTest {
    @Test fun recreatedBridgeCannotReplaceUnreadableStateWithItsCachedSnapshot() {
        val dir = Files.createTempDirectory("manga-store-corruption").toFile()
        try {
            val file = File(dir, "state.json")
            val oldBridge = UserExtensionStore(file)
            UserExtensionStore(file).dismissReadyCatalogue()
            file.writeText("{unreadable")
            assertThrows(IllegalStateException::class.java) { oldBridge.update { UserExtensionState() } }
            assertEquals("{unreadable", file.readText())
            assertTrue(oldBridge.state.readyCatalogDismissed)
            assertThrows(IllegalStateException::class.java) { UserExtensionStore(file) }
        } finally { dir.deleteRecursively() }
    }

    @Test fun olderBridgeCannotRestoreADismissedCatalogueWhileRegisteringARepository() {
        val dir = Files.createTempDirectory("manga-bridge-recreation").toFile()
        try {
            val file = File(dir, "state.json")
            val oldBridge = UserExtensionStore(file)
            val newBridge = UserExtensionStore(file)
            newBridge.dismissReadyCatalogue()
            val repo = UserRepo("https://repo.example", "Repo", "a".repeat(64))
            oldBridge.update { it.copy(repos = listOf(repo)) }
            assertTrue(UserExtensionStore(file).state.readyCatalogDismissed)
            assertTrue(oldBridge.state.readyCatalogDismissed)
            assertEquals(listOf(repo), newBridge.state.repos)
        } finally { dir.deleteRecursively() }
    }

    @Test fun unlinkAndDismissSurviveRecreationAndRetainTheFullInstalledRecord() {
        val dir = Files.createTempDirectory("optional-manga-repo").toFile()
        try {
            val file = File(dir, "state.json")
            val store = UserExtensionStore(file)
            val repo = UserRepo("https://repo.example", "External repo", "a".repeat(64))
            val installed = UserExtension(repo.url, "Manga", "example.manga", "${repo.url}/source.apk",
                "b".repeat(64), "1.6.2", 1.6, "ar", false, listOf(UserSource("42", "Manga", "ar")),
                aliases = mapOf("41" to "42"), versionCode = 2)
            val library = File(dir, "library.json").apply { writeText("library and reading progress fixture") }
            store.update { it.copy(repos = listOf(repo), extensions = listOf(installed)) }
            store.unlinkRepository(repo.url)
            store.dismissReadyCatalogue()
            val reopened = UserExtensionStore(file).state
            assertEquals(emptyList<UserRepo>(), reopened.repos)
            assertEquals(listOf(installed), reopened.extensions)
            assertTrue(reopened.readyCatalogDismissed)
            assertEquals("library and reading progress fixture", library.readText())
            // Registering the external repository again must not restore the dismissed catalogue.
            val again = UserExtensionStore(file)
            again.update { it.copy(repos = listOf(repo)) }
            assertTrue(UserExtensionStore(file).state.readyCatalogDismissed)
            assertEquals(listOf(installed), again.state.extensions)
        } finally { dir.deleteRecursively() }
    }

    @Test fun olderStoreWithoutTheOptionalFlagKeepsItsRepositories() {
        val dir = Files.createTempDirectory("legacy-manga-repo").toFile()
        try {
            val file = File(dir, "state.json")
            file.writeText("""{"repos":[{"url":"https://repo.example","name":"Old repo","fingerprint":"old"}],"extensions":[]}""")
            val store = UserExtensionStore(file)
            assertFalse(store.state.readyCatalogDismissed)
            assertEquals("Old repo", store.state.repos.single().name)
        } finally { dir.deleteRecursively() }
    }
}
