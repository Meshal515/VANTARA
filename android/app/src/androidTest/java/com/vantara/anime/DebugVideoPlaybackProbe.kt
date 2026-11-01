package com.vantara.anime

import android.app.Instrumentation
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.player.PlayerActivity
import com.vantara.anime.stream.Preferences
import org.junit.Assert.*
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

/** Test-only measurement of the production preparation, player and quality sheet. No synthetic URL. */
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
object DebugVideoPlaybackProbe {
    fun <T> onMain(ins: Instrumentation, read: () -> T): T {
        val value = AtomicReference<T>(); ins.runOnMainSync { value.set(read()) }; return value.get()
    }

    suspend fun run(ins: Instrumentation, engine: AnimeEngine, work: SourceAnime, number: Float): String {
        val id = "real-repository-" + UUID.randomUUID()
        val prep = engine.prepare(id, listOf(work), number, Preferences(quality = 480))
        var activity: PlayerActivity? = null
        try {
            val first = prep.awaitBest(null, 90_000) ?: error("NO_NATIVE_PREPARED_CANDIDATE")
            activity = ins.startActivitySync(PlayerActivity.intent(ins.targetContext,
                PlayerActivity.Launch(session = id, title = "VANTARA compatibility test", episode = number,
                    candidate = first.id)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) as PlayerActivity
            val current = activity
            val field = PlayerActivity::class.java.getDeclaredField("player").apply { isAccessible = true }
            val player = field.get(current) as ExoPlayer
            fun <T> read(block: () -> T): T = onMain(ins, block)
            fun await(label: String, condition: () -> Boolean) {
                val end = SystemClock.elapsedRealtime() + 45_000
                while (SystemClock.elapsedRealtime() < end) {
                    assertNull("$label: native player failure", read { player.playerError?.errorCodeName })
                    if (read(condition)) return
                    Thread.sleep(100)
                }
                error("PLAYER_CONDITION_TIMEOUT:$label")
            }
            read { player.volume = 0f }
            await("first decoded frame") { (player.videoDecoderCounters?.renderedOutputBufferCount ?: 0) > 0 && player.isPlaying }
            val initial = read { player.currentPosition }
            val frames = read { player.videoDecoderCounters?.renderedOutputBufferCount ?: 0 }
            val began = SystemClock.elapsedRealtime()
            while (SystemClock.elapsedRealtime() - began < 30_000) {
                assertNull(read { player.playerError?.errorCodeName }); Thread.sleep(200)
            }
            val advanced = read { player.currentPosition } - initial
            val rendered = read { player.videoDecoderCounters?.renderedOutputBufferCount ?: 0 } - frames
            assertTrue("Clock did not advance for 25 seconds", advanced >= 25_000)
            assertTrue("Insufficient decoded frames", rendered >= 200)
            val forward = read { player.currentPosition + 30_000 }
            read { player.seekTo(forward) }
            await("forward seek") { player.isPlaying && player.currentPosition in (forward + 500)..(forward + 8_000) }
            val backward = (forward - 15_000).coerceAtLeast(0)
            read { player.seekTo(backward) }
            await("backward seek") { player.isPlaying && player.currentPosition in (backward + 500)..(backward + 8_000) }

            fun texts(node: View): List<TextView> = listOfNotNull(node as? TextView) +
                if (node is ViewGroup) (0 until node.childCount).flatMap { texts(node.getChildAt(it)) } else emptyList()
            val qualityMethod = PlayerActivity::class.java.getDeclaredMethod("showQuality").apply { isAccessible = true }
            val heights = read {
                val video = player.currentTracks.groups.filter { it.type == C.TRACK_TYPE_VIDEO }
                (video.flatMap { g -> (0 until g.length).filter { g.isTrackSupported(it) }.map { g.getTrackFormat(it).height } } +
                    prep.routes().filter { it.state == com.vantara.anime.stream.RouteState.READY }.mapNotNull { it.quality })
                    .filter { it > 0 }.distinct().sorted()
            }
            assertTrue("Source did not declare any measurable video quality", heights.isNotEmpty())
            // Exercise every available height, through the actual quality sheet's click listeners.
            for (height in heights) {
                val beforePosition = read { player.currentPosition }
                val beforeCounters = read { player.videoDecoderCounters }
                val beforeFrames = beforeCounters?.renderedOutputBufferCount ?: 0
                read {
                    qualityMethod.invoke(current)
                    val label = texts(current.window.decorView).lastOrNull { it.text.toString() == "${height}p" }
                        ?: error("QUALITY_MISSING_FROM_NATIVE_SHEET:$height")
                    var action: View = label
                    while (!action.isClickable && action.parent is View) action = action.parent as View
                    if (action.isClickable) action.performClick()
                    else check(player.videoFormat?.height == height) { "QUALITY_NOT_SELECTABLE:$height" }
                }
                await("quality $height") {
                    player.isPlaying && player.videoFormat?.height == height &&
                        (player.videoDecoderCounters?.let { counters ->
                            counters.renderedOutputBufferCount > (if (counters === beforeCounters) beforeFrames else 0)
                        } == true)
                }
                assertTrue("Quality switch lost the playback position", read { player.currentPosition } >= beforePosition - 5_000)
            }
            return "advancedMs=$advanced;decodedFrames=$rendered;seekForward=true;seekBackward=true;qualities=${heights.joinToString(",")};processRestart=NOT_TESTED"
        } finally {
            activity?.let { onMain(ins) { it.finish() } }
            engine.closeSession(id)
        }
    }
}
