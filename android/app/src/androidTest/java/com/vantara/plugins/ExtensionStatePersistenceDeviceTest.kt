package com.vantara.plugins

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.registry.UserAnimeStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Runs on Android: AtomicFile is not implemented in the plain JVM android.jar. */
@RunWith(AndroidJUnit4::class)
class ExtensionStatePersistenceDeviceTest {
    private fun storage(name: String): File {
        val base = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "store-test-${System.nanoTime()}")
        check(base.mkdirs())
        return File(base, name)
    }

    @Test fun mangaStateSurvivesRestartAndRejectsCorruption() {
        val file = storage("manga.json")
        val repo = UserRepo("https://repo.example", "Example", "a".repeat(64))
        val store = UserExtensionStore(file)
        store.update { it.copy(repos = listOf(repo)) }
        assertEquals(listOf(repo), UserExtensionStore(file).state.repos)
        file.writeText("corrupt-json")
        assertThrows(IllegalStateException::class.java) { UserExtensionStore(file) }
        assertEquals(listOf(repo), store.state.repos)
    }

    @Test fun aniyomiStateSurvivesRestartAndRejectsCorruption() {
        val file = storage("aniyomi.json")
        val repo = UserRepo("https://anime.example", "Anime", "b".repeat(64))
        val store = UserAnimeStore(file)
        store.update { it.copy(repos = listOf(repo)) }
        assertEquals(listOf(repo), UserAnimeStore(file).state.repos)
        file.writeText("{bad-json")
        assertThrows(IllegalStateException::class.java) { UserAnimeStore(file) }
        assertTrue(store.state.repos.isNotEmpty())
    }

    @Test fun firstInstallIsEmptyWithoutAStateFile() {
        assertTrue(UserExtensionStore(storage("fresh-manga.json")).state.extensions.isEmpty())
        assertTrue(UserAnimeStore(storage("fresh-anime.json")).state.extensions.isEmpty())
    }
}
