package com.vantara.anime

import com.vantara.anime.health.HealthStore
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.PreparedEpisode
import kotlinx.coroutines.Job
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A native deadline must settle only abandoned providers, never duplicate a batch. */
class AddonBatchCompletionTest {
    private fun episode(): PreparedEpisode {
        val health = HealthStore(null)
        return PreparedEpisode(
            "s", emptyList(), 1f, Preferences(),
            PlaybackSession(emptyList(), health), health,
            addonGeneration = "generation",
        ).also { it.job = Job() }
    }

    @Test fun absentBridgeIsDrainedAfterNativePreparation() {
        val prep = episode()
        assertEquals(2, prep.reserveAddonBatches(listOf("addon|fast", "addon|stuck")))
        prep.finish() // primary (non-addon) preparation completed
        assertFalse(prep.done)
        assertTrue(prep.claimAddonBatch("addon|fast", "generation"))
        prep.finish()
        assertFalse(prep.done)
        assertEquals(1, prep.expireAddonBatches())
        assertTrue(prep.done)
        assertEquals(0, prep.expireAddonBatches())
        assertFalse(prep.claimAddonBatch("addon|stuck", "generation"))
    }

    @Test fun wrongGenerationCannotCompleteAnotherSessionsWork() {
        val prep = episode()
        prep.reserveAddonBatches(listOf("addon|provider"))
        assertFalse(prep.claimAddonBatch("addon|provider", "old-generation"))
        prep.finish()
        assertEquals(1, prep.expireAddonBatches())
        assertTrue(prep.done)
    }

    @Test fun duplicatesDoNotDoubleReserveOrDoubleFinish() {
        val prep = episode()
        assertEquals(1, prep.reserveAddonBatches(listOf("addon|provider", "addon|provider")))
        prep.finish()
        assertTrue(prep.claimAddonBatch("addon|provider"))
        assertFalse(prep.claimAddonBatch("addon|provider"))
        prep.finish()
        assertTrue(prep.done)
    }
}
