package com.vantara.anime.player

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackSeekBudgetTest {
    private val torrent = "vantara-torrent://ticket/file"

    @Test fun torrentSeekCanRefillPastTheOrdinaryStallDeadline() {
        val budget = PlaybackSeekBudget()
        budget.seek(torrent, 10_000)
        assertEquals(85_000L, budget.stalledMs(torrent, 45_000))
    }

    @Test fun bufferingNotificationsCannotRenewTheSameSeekForever() {
        val budget = PlaybackSeekBudget()
        budget.seek(torrent, 10_000)
        assertEquals(10_000L, budget.stalledMs(torrent, 120_000))
        assertEquals(0L, budget.stalledMs(torrent, 130_000))
    }

    @Test fun readyPlaybackRestoresTheOrdinaryStallBudget() {
        val budget = PlaybackSeekBudget()
        budget.seek(torrent, 10_000)
        budget.reset()
        assertEquals(35_000L, budget.stalledMs(torrent, 20_000))
    }

    @Test fun anotherExplicitSeekGetsABudgetForItsNewTarget() {
        val budget = PlaybackSeekBudget()
        budget.seek(torrent, 10_000)
        budget.seek(torrent, 120_000)
        assertEquals(120_000L, budget.stalledMs(torrent, 120_000))
    }

    @Test fun ordinaryPlaybackAndHttpSeeksKeepTheirExistingLimits() {
        val budget = PlaybackSeekBudget()
        assertEquals(35_000L, budget.stalledMs(torrent, 0))
        budget.seek("https://video.example/movie.mp4", 10_000)
        assertEquals(20_000L, budget.stalledMs("https://video.example/movie.mp4", 10_000))
        assertEquals(90_000L, PlaybackBudgets.startupMs(torrent))
        assertEquals(15_000L, PlaybackBudgets.startupMs("https://video.example/movie.mp4"))
    }
}
