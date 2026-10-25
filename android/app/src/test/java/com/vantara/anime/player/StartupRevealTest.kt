package com.vantara.anime.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StartupRevealTest {
    @Test fun `ready before the first frame keeps the logo on screen`() {
        assertFalse(StartupReveal.hideOnReady(firstFrameShown = false, hasVideo = true))
    }

    @Test fun `the first frame reveals the picture even before ready`() {
        assertTrue(StartupReveal.hideOnFirstFrame(startup = true, ready = false))
    }

    @Test fun `a frame after a seek does not hide the wait before ready`() {
        assertFalse(StartupReveal.hideOnFirstFrame(startup = false, ready = false))
        assertTrue(StartupReveal.hideOnFirstFrame(startup = false, ready = true))
    }

    @Test fun `a stall during watching ends on ready as before`() {
        assertTrue(StartupReveal.hideOnReady(firstFrameShown = true, hasVideo = true))
    }

    @Test fun `a server switch waits for the new first frame again`() {
        // start() يعيد firstFrameShown=false مع كل سيرفر جديد
        assertFalse(StartupReveal.hideOnReady(firstFrameShown = false, hasVideo = true))
    }

    @Test fun `audio only media never renders a frame so ready ends the wait`() {
        assertTrue(StartupReveal.hideOnReady(firstFrameShown = false, hasVideo = false))
    }
}
