package com.vantara.runtime

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Regression for source IDs being stable across CloudStream package revisions.
 * All stored libraries and watching histories continue referencing the old source IDs. */
class RuntimeUpdateAdmissionTest {
    private fun registration(vararg names: String): JsonObject = buildJsonObject {
        put("sources", JsonArray(names.map { name -> buildJsonObject { put("name", name) } }))
    }
    private fun old(vararg names: String) = buildJsonObject { put("registration", registration(*names)) }

    @Test fun updateCanAddSourcesButCannotDeleteAnExistingSource() {
        RuntimeUpdateAdmission.preserveIds(old("Animewitcher", "Extra Site"), registration("Extra Site", "Animewitcher", "Added Site"))
        try {
            RuntimeUpdateAdmission.preserveIds(old("Animewitcher", "Extra Site"), registration("Animewitcher"))
            fail("Update silently removed a source whose stable ID may be referenced in user data")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message.orEmpty().startsWith("RUNTIME_SOURCE_REMOVED"))
        }
    }
    @Test fun renameAndCaseChangesAreAlsoIdentityChanges() {
        for (changed in listOf("AnimeWitcher", "Animewitcher 2", "animewitcher")) {
            try {
                RuntimeUpdateAdmission.preserveIds(old("Animewitcher"), registration(changed))
                fail("Accepted an identity-changing rename: $changed")
            } catch (expected: IllegalArgumentException) {
                assertTrue(expected.message.orEmpty().startsWith("RUNTIME_SOURCE_REMOVED"))
            }
        }
    }
    @Test fun firstInstallHasNoPriorIdentitiesAndSameSourceIsStable() {
        RuntimeUpdateAdmission.preserveIds(null, registration("First"))
        RuntimeUpdateAdmission.preserveIds(old("First"), registration("First"))
    }
}
