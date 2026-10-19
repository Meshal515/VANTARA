package com.vantara.anime.player.together

import org.junit.Assert.*
import org.junit.Test

class LocalClipPreviewTest {
    @Test fun `editor play seek report and drift effects remain local until catchup`() {
        val preview = LocalClipPreview()
        val roomEffects = mutableListOf<String>()
        preview.begin(12)
        for (effect in listOf("host-seek", "host-play", "host-pause", "guest-correction", "status")) {
            preview.shared { roomEffects += effect }
        }
        assertTrue(roomEffects.isEmpty())
        assertEquals(LocalClipPreview.Resume.ROOM, preview.end(12, synced = true))
        preview.shared { roomEffects += "catchup" }
        assertEquals(listOf("catchup"), roomEffects)
        // Catchup follows today's room clock and the personal source offset, not the editor's saved position.
        val timeline = Timeline("anime:1#12", null, true, true, 60000.0, 10000.0, 1.0, 5)
        assertEquals(87000.0, targetAt(timeline, 30000.0, 7000.0), 0.0)
    }
    @Test fun `remote episode switch invalidates editor restoration before it closes`() {
        val preview = LocalClipPreview()
        preview.begin(12)
        preview.invalidate()
        var sent = false
        preview.shared { sent = true }
        assertFalse(sent)
        assertEquals(LocalClipPreview.Resume.ABANDON, preview.end(12, synced = true))
        assertFalse(preview.active)
    }
    @Test fun `changed episode and destroyed editor never restore old clip position`() {
        val preview = LocalClipPreview()
        preview.begin(12)
        assertEquals(LocalClipPreview.Resume.ABANDON, preview.end(13, synced = true))
        assertEquals(LocalClipPreview.Resume.ABANDON, preview.end(13, synced = true))
        preview.begin(13)
        preview.invalidate()
        assertEquals(LocalClipPreview.Resume.ABANDON, preview.end(13, synced = false))
    }
    @Test fun `independent mode retains personal pre-editor playback behavior`() {
        val preview = LocalClipPreview()
        preview.begin(12)
        assertEquals(LocalClipPreview.Resume.LOCAL, preview.end(12, synced = false))
    }
}
