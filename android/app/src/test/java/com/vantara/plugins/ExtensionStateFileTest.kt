package com.vantara.plugins

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class ExtensionStateFileTest {
    @Test fun interruptedCommitRestoresPreviousState() {
        val dir = Files.createTempDirectory("extension-store-recovery").toFile()
        val file = File(dir, "state.json")
        try {
            val storage = ExtensionStateFile(file)
            storage.write("known-good")
            val backup = File(file.path + ".bak")
            assertTrue(file.renameTo(backup))
            assertEquals("known-good", storage.read("empty") { it })
            assertTrue(file.exists())
            backup.writeText("known-good")
            file.writeText("bad")
            assertEquals("known-good", storage.read("empty") {
                if (it == "bad") throw IllegalStateException("parse failed")
                it
            })
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun corruptExistingStateNeverBecomesEmpty() {
        val dir = Files.createTempDirectory("extension-store-corruption").toFile()
        try {
            val file = File(dir, "state.json")
            file.writeText("{not-json")
            assertThrows(IllegalStateException::class.java) {
                ExtensionStateFile(file).read("empty") {
                    if (it == "{not-json") error("invalid JSON")
                    it
                }
            }
        } finally {
            dir.deleteRecursively()
        }
    }
}
