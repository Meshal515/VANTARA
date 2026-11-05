package com.vantara.anime.player

import org.junit.Assert.*
import org.junit.Test

class PlaybackWorkTest {
    @Test fun `anime movies and one episode TV works keep their distinct formats`() {
        assertTrue(PlaybackWork.isMovie("anime", "MOVIE", 1))
        assertFalse(PlaybackWork.isMovie("anime", "TV", 1))
        assertFalse(PlaybackWork.isMovie("cinema", "TV", 1))
        assertTrue(PlaybackWork.isMovie("cinema", null, 1))
    }
}
