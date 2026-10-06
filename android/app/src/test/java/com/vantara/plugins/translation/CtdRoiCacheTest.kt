package com.vantara.plugins.translation

import org.junit.Assert.*
import org.junit.Test

class CtdRoiCacheTest {
    private fun mask(w:Int=400,h:Int=400):ByteMask =
        ByteMask(w,h).apply {
            fillRect(42,55,77,91)
            fillRect(210,180,244,219)
        }

    @Test fun `same page and roi plan reuses the exact thresholded glyph mask regardless of crop order`() {
        val cache=CtdRoiCache(maxEntries=4,maxEnclosingPixels=1_200_000)
        val crops=listOf(Box(20,30,120,130),Box(180,150,280,250))
        val source=mask()
        assertTrue(cache.put("page-a",crops,source))

        val packed=cache.get("page-a",crops.reversed())
        assertNotNull(packed)
        assertArrayEquals(source.data,packed!!.unpack().data)
        assertNull("page identity must be part of the CTD cache key",cache.get("page-b",crops))
    }

    @Test fun `roi cache is bounded and uses LRU eviction`() {
        val cache=CtdRoiCache(maxEntries=2,maxEnclosingPixels=1_200_000)
        val a=listOf(Box(0,0,100,100))
        val b=listOf(Box(100,0,200,100))
        val c=listOf(Box(200,0,300,100))
        val source=mask()
        assertTrue(cache.put("page",a,source))
        assertTrue(cache.put("page",b,source))
        assertNotNull(cache.get("page",a)) // a becomes most-recent
        assertTrue(cache.put("page",c,source))
        assertNotNull(cache.get("page",a))
        assertNull("least-recent CTD plan must be evicted",cache.get("page",b))
        assertNotNull(cache.get("page",c))
    }

    @Test fun `cache refuses a plan whose enclosing mask could retain too many page pixels`() {
        val cache=CtdRoiCache(maxEntries=8,maxEnclosingPixels=120_000)
        val far=listOf(Box(0,0,100,100),Box(900,900,1000,1000))
        assertFalse(cache.put("page",far,mask(1000,1000)))
        assertNull(cache.get("page",far))
    }

    @Test fun `demand metrics distinguish source pixels from overlap and unique coverage`() {
        val crops=listOf(Box(0,0,100,100),Box(50,50,150,150))
        assertEquals(20_000,CtdRoiDemand.sourcePixels(crops))
        assertEquals(17_500,CtdRoiDemand.uniquePixels(crops))
        assertEquals(2_500,CtdRoiDemand.overlapPixels(crops))
        assertEquals(22_500,CtdRoiDemand.enclosingPixels(crops))
    }
}
