package com.vantara.anime

import com.vantara.anime.player.SeekRecovery
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** TS1: عطل بعد تشغيل ناجح وقفزة قريبة يعيد المصدر نفسه (مرتين)، لا يبدّل بمصدر يبدأ من الصفر. */
class SeekRecoveryTest {
    @Test fun aFailureRightAfterASeekRetriesTheSameSourceTwiceThenSwitches() {
        val r = SeekRecovery()
        r.seeked(1_000)
        assertTrue(r.shouldRetry("torrent-a", startedBefore = true, now = 31_000))
        assertTrue(r.shouldRetry("torrent-a", startedBefore = true, now = 61_000))
        assertFalse("بعد مرتين: التبديل كما كان", r.shouldRetry("torrent-a", startedBefore = true, now = 62_000))
    }

    @Test fun noSeekOrNoSuccessfulStartMeansSwitchAsBefore() {
        val r = SeekRecovery()
        assertFalse("بلا قفزة", r.shouldRetry("s", startedBefore = true, now = 10_000))
        r.seeked(10_000)
        assertFalse("لم يبدأ التشغيل أصلًا", r.shouldRetry("s", startedBefore = false, now = 11_000))
        assertFalse("قفزة قديمة", r.shouldRetry("s", startedBefore = true, now = 10_000 + SeekRecovery.WINDOW_MS + 1))
    }
}
