package com.vantara.plugins

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.registry.UserAnimeStore
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/** Real Android: never replace unreadable installed state with an empty list. */
@RunWith(AndroidJUnit4::class)
class ExtensionStateAtomicityDeviceTest {
    private fun temp(): File = File(
        InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,
        "extension-atomicity-${UUID.randomUUID()}.json",
    )

    @Test fun mangaStateCommittedThenCorruptFailsClosed() {
        val file = temp()
        try {
            val before = UserExtensionStore(file)
            before.update { it }
            assertTrue(file.exists())
            UserExtensionStore(file)
            file.writeText("{invalid-json")
            assertThrows(IllegalStateException::class.java) { UserExtensionStore(file) }
        } finally {
            file.delete()
            File(file.path + ".bak").delete()
            File(file.path + ".new").delete()
        }
    }

    @Test fun animeStateCommittedThenCorruptFailsClosed() {
        val file = temp()
        try {
            val before = UserAnimeStore(file)
            before.update { it }
            assertTrue(file.exists())
            UserAnimeStore(file)
            file.writeText("{invalid-json")
            assertThrows(IllegalStateException::class.java) { UserAnimeStore(file) }
        } finally {
            file.delete()
            File(file.path + ".bak").delete()
            File(file.path + ".new").delete()
        }
    }
}
