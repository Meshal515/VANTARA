package dev.vantara.spike

import eu.kanade.tachiyomi.source.model.SManga
import org.junit.Assert.assertEquals
import org.junit.Test

class ProbeValueDescriptionTest {

    @Test
    fun uninitializedMangaDoesNotTurnSuccessfulDetailsIntoFailure() {
        val manga = SManga.create().apply {
            url = "/comic"
        }

        assertEquals("SManga بلا عنوان بعد", describeProbeValue(manga))
    }
}
