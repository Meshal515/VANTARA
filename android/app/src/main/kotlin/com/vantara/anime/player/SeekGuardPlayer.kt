package com.vantara.anime.player

import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer

/**
 * يمرّر كل شيء إلى [inner]، والقفز يمر أولًا على [intercept]: إن أعادت true فهي تولّت القفز (مثلًا إعادة تجهيز المصدر
 * بفهرس الحاوية عند الموضع المطلوب) ولا يصل [inner]. المصدر الذي بدأ بلا فهرس (CandidateMediaSources.deferCues)
 * لا يقبل القفز، وMedia3 يرجعه إلى البداية بصمت؛ هذا الحارس يمنع ذلك في نقطة واحدة لكل من يقفز.
 */
@UnstableApi
class SeekGuardPlayer(private val inner: ExoPlayer, private val intercept: (Long) -> Boolean) : ExoPlayer by inner {
    override fun seekTo(positionMs: Long) { if (!intercept(positionMs)) inner.seekTo(positionMs) }
    override fun seekTo(mediaItemIndex: Int, positionMs: Long) { if (!intercept(positionMs)) inner.seekTo(mediaItemIndex, positionMs) }
    override fun seekBack() { if (!intercept((inner.currentPosition - inner.seekBackIncrement).coerceAtLeast(0))) inner.seekBack() }
    override fun seekForward() { if (!intercept(inner.currentPosition + inner.seekForwardIncrement)) inner.seekForward() }
}
