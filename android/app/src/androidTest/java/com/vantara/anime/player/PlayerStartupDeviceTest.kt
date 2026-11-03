package com.vantara.anime.player

import android.app.Instrumentation
import android.content.Intent
import android.os.SystemClock
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.AnimeEngine
import com.vantara.anime.health.HealthStore
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.TrackRef
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference

/** Production Activity + renderer callbacks, with authored bytes copied from the test APK. */
@RunWith(AndroidJUnit4::class)
class PlayerStartupDeviceTest {
    private val ins = InstrumentationRegistry.getInstrumentation()
    private fun <T> main(block: () -> T): T {
        val value = AtomicReference<T>(); ins.runOnMainSync { value.set(block()) }; return value.get()
    }
    private fun field(activity: PlayerActivity, name: String): Any? = PlayerActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.get(activity)
    private fun await(label: String, timeoutMs: Long = 25_000, check: () -> Boolean) {
        val until = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < until) { if (main(check)) return; Thread.sleep(50) }
        error("PLAYER_STARTUP_PROOF_TIMEOUT:$label")
    }

    private fun withPlayer(name: String, block: (PlayerActivity, ExoPlayer, PlaybackSession, MutableList<JSONObject>, File) -> Unit) {
        val context = ins.targetContext
        val id = "startup-proof-${UUID.randomUUID()}"
        val files = File(context.cacheDir, id).apply { mkdirs() }
        val events = CopyOnWriteArrayList<JSONObject>()
        val previous = PlaybackEvents.events
        val engine = AnimeEngine.get(context)
        val session = PlaybackSession(emptyList(), HealthStore(null))
        @Suppress("UNCHECKED_CAST")
        val sessions = AnimeEngine::class.java.getDeclaredField("sessions").apply { isAccessible = true }.get(engine) as MutableMap<String, PlaybackSession>
        sessions[id] = session
        var activity: PlayerActivity? = null
        val proof = JSONObject().put("test", name).put("fixture", "authored H264/AAC local files").put("passed", false)
        try {
            // Begin with a real but empty test session, then start on the Activity's main thread.
            // This allows surface detachment BEFORE decoding in the no-first-frame regression.
            activity = ins.startActivitySync(PlayerActivity.intent(context,
                PlayerActivity.Launch(session = id, title = "Authored playback validation", animeId = id, total = 1))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as PlayerActivity
            val current = activity
            val player = field(current, "player") as ExoPlayer
            PlaybackEvents.events = { event, data ->
                if (event == "playstat") events += JSONObject(data.toString()).put("frameAt", field(current, "frameAt"))
            }
            main { PlayerActivity::class.java.getDeclaredMethod("attemptBegin").apply { isAccessible = true }.invoke(current) }
            block(current, player, session, events, files)
            proof.put("passed", true)
        } catch (failure: Throwable) { proof.put("failure", failure.toString()); throw failure }
        finally {
            PlaybackEvents.events = previous
            activity?.let { current -> main { current.finish() }; ins.waitForIdleSync() }
            engine.closeSession(id)
            File(context.filesDir, "addon-proof/startup-$name.json").apply { parentFile!!.mkdirs(); writeText(proof.put("events", JSONArray(events)).toString(2)) }
            android.util.Log.i("VantaraRuntime", "PHASE2_STARTUP_PROOF ${proof}")
            files.deleteRecursively() // Only this test's UUID directory.
        }
    }

    private fun fixture(files: File, name: String): String {
        val file = File(files, name)
        ins.context.assets.open("player-audio/$name").use { input -> file.outputStream().use(input::copyTo) }
        return file.toURI().toString()
    }
    private fun candidate(id: String, url: String, audio: List<TrackRef> = emptyList()) = Candidate(id, "fixture", "Authored fixture", id, "local-file", url,
        container = if (url.endsWith("mp4")) Container.MP4 else Container.UNKNOWN, audio = audio, resolvedAt = 0, expiresAt = Long.MAX_VALUE,
        preparationMs = 123)
    private fun start(activity: PlayerActivity, session: PlaybackSession, candidate: Candidate, position: Long = 0) {
        session.append(listOf(candidate)); session.take(candidate.id)
        PlayerActivity::class.java.getDeclaredMethod("start", Candidate::class.java, java.lang.Long.TYPE, java.lang.Boolean.TYPE)
            .apply { isAccessible = true }.invoke(activity, candidate, position, false)
    }

    @Test fun readyWithoutAVideoSurfaceCannotReportVisualSuccessAndTimesOut() = withPlayer("ready-no-frame") { activity, player, session, events, files ->
        val candidate = candidate("no-frame", fixture(files, "primary.mp4"))
        main {
            (field(activity, "video") as PlayerView).player = null
            player.clearVideoSurface()
            start(activity, session, candidate)
        }
        await("READY without surface") { player.playbackState == Player.STATE_READY }
        main {
            assertEquals(false, field(activity, "reportedStart"))
            assertEquals(0L, field(activity, "frameAt"))
            assertTrue(events.none { it.optString("outcome") == "ok" })
        }
        await("first frame watchdog failover") { session.isFailed(candidate.id) }
        assertTrue("READY-only playback must remain unreported", events.none { it.optString("outcome") == "ok" })
        assertTrue(events.any { it.optString("reason") == "FIRST_VIDEO_FRAME_TIMEOUT" && it.optString("outcome") == "timeout" })
    }

    @Test fun advancingAudioOnlyHasSeparateSuccessAndNeverWaitsForAVideoFrame() = withPlayer("audio-only") { activity, player, session, events, files ->
        main { start(activity, session, candidate("audio-only", fixture(files, "alternate.m4a"))) }
        await("advancing audio-only output") { field(activity, "reportedStart") == true && player.currentPosition > 200 }
        main { assertEquals(0L, field(activity, "frameAt")); assertFalse(player.currentTracks.containsType(C.TRACK_TYPE_VIDEO)) }
        assertTrue(events.any { it.optString("stage") == "audio_play" && it.optString("outcome") == "ok" })
        assertTrue(events.none { it.optString("stage") in setOf("play", "server") && it.optString("outcome") == "ok" })
    }

    @Test fun videoSuccessHasARealFrameAndSupportsSeekPauseResumeAndServerSwitch() = withPlayer("video-journey") { activity, player, session, events, files ->
        val url = fixture(files, "primary.mp4")
        main { start(activity, session, candidate("video-one", url)) }
        await("real first frame") { field(activity, "reportedStart") == true && player.currentPosition > 300 }
        main {
            assertTrue((field(activity, "frameAt") as Long) > 0)
            assertTrue(player.currentTracks.containsType(C.TRACK_TYPE_TEXT))
            player.seekTo(3000)
        }
        await("seek continues") { player.isPlaying && player.currentPosition >= 3300 }
        val paused = main { player.pause(); player.currentPosition }
        Thread.sleep(350)
        assertTrue("Pause must retain the position", main { player.currentPosition } - paused < 100)
        main { player.play() }
        await("resume continues") { player.currentPosition > paused + 300 }
        val at = main { player.currentPosition }
        main { start(activity, session, candidate("video-two", url), at) }
        await("replacement server frame and position") { player.currentMediaItem?.mediaId?.startsWith("video-two|attempt|") == true && field(activity, "reportedStart") == true && player.currentPosition >= at + 200 }
        assertTrue("Every visual success needs renderer evidence", events.filter { it.optString("outcome") == "ok" }.all { it.optLong("frameAt") > 0 })
        assertEquals(2, events.count { it.optString("stage") == "server" && it.optString("outcome") == "ok" })
    }

    @Test fun missingOptionalAudioRetriesTheSameCandidateOnceAndPreservesVideo() = withPlayer("audio-fallback") { activity, player, session, events, files ->
        val candidate = candidate("optional-audio", fixture(files, "primary.mp4"), listOf(TrackRef(File(files, "absent.m4a").toURI().toString(), "ar")))
        main { start(activity, session, candidate, 2000) }
        await("primary-only recovery") { field(activity, "retriedWithoutAudio") == true && field(activity, "reportedStart") == true && player.currentPosition >= 2200 }
        main {
            assertEquals(candidate.id, (field(activity, "current") as Candidate).id)
            assertFalse(session.isFailed(candidate.id))
            assertTrue((field(activity, "externalAudioUrls") as Set<*>).isEmpty())
        }
        assertTrue(events.none { it.optString("stage") == "server" && it.optString("outcome") in setOf("error", "timeout") })
        assertEquals(1, events.count { it.optString("stage") == "server" && it.optString("outcome") == "ok" })
    }
    @Test fun interruptedHttpReadFailsOverWithoutResettingTheSeekPosition() = withPlayer("network-failover") { activity, player, session, events, files ->
        val url = fixture(files, "primary.mp4")
        val bytes = File(java.net.URI(url)).readBytes()
        InterruptibleMediaServer(bytes).use { server ->
            val backup = candidate("network-backup", url)
            main {
                session.append(listOf(backup))
                start(activity, session, candidate("network-primary", server.url))
            }
            await("network primary first frame") { (field(activity, "current") as? Candidate)?.id == "network-primary" && field(activity, "reportedStart") == true }
            val target = main {
                server.interrupt()
                player.seekTo(9_000)
                player.currentPosition
            }
            await("network failure preserved seek on backup", 40_000) {
                (field(activity, "current") as? Candidate)?.id == backup.id && field(activity, "reportedStart") == true && player.currentPosition >= target + 150
            }
            assertTrue(session.isFailed("network-primary"))
            assertTrue("No actual HTTP request was interrupted", server.interruptedRequests.get() > 0)
            assertTrue(events.any { it.optString("stage") == "server" && it.optString("sourceId") == "network-primary" && it.optString("outcome") == "error" })
        }
    }

    /** Slow, real ranged HTTP. interrupt() closes active TCP sockets and rejects retries. */
    private class InterruptibleMediaServer(private val bytes: ByteArray) : AutoCloseable {
        private val listener = java.net.ServerSocket(0, 10, java.net.InetAddress.getByName("127.0.0.1"))
        private val sockets = java.util.Collections.synchronizedSet(mutableSetOf<java.net.Socket>())
        private val dropped = java.util.concurrent.atomic.AtomicBoolean(false)
        private val running = java.util.concurrent.atomic.AtomicBoolean(true)
        val interruptedRequests = java.util.concurrent.atomic.AtomicInteger()
        val url = "http://127.0.0.1:${listener.localPort}/primary.mp4"
        private val acceptor = kotlin.concurrent.thread(name = "PlaybackDisconnectHttp", isDaemon = true) {
            while (running.get()) try {
                val socket = listener.accept(); sockets.add(socket)
                kotlin.concurrent.thread(name = "PlaybackDisconnectRequest", isDaemon = true) {
                    try { socket.use { serve(it) } } catch (_: Exception) { /* deliberate disconnect */ }
                    finally { sockets.remove(socket) }
                }
            } catch (_: Exception) { if (running.get()) throw IllegalStateException("Fixture accept failed") }
        }
        private fun serve(socket: java.net.Socket) {
            socket.soTimeout = 10_000
            val reader = socket.getInputStream().bufferedReader()
            reader.readLine() ?: return
            var start = 0
            var ranged = false
            while (true) {
                val line = reader.readLine() ?: return
                if (line.isEmpty()) break
                if (line.startsWith("range:", true)) {
                    ranged = true; start = line.substringAfter("bytes=").substringBefore('-').toInt()
                }
            }
            if (dropped.get()) { interruptedRequests.incrementAndGet(); return }
            val output = socket.getOutputStream()
            val header = "HTTP/1.1 ${if (ranged) "206 Partial Content" else "200 OK"}\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: ${bytes.size - start}\r\n" +
                (if (ranged) "Content-Range: bytes $start-${bytes.size - 1}/${bytes.size}\r\n" else "") + "Connection: close\r\n\r\n"
            output.write(header.toByteArray()); output.flush()
            var position = start
            while (position < bytes.size && !dropped.get()) {
                val count = minOf(4_096, bytes.size - position)
                output.write(bytes, position, count); output.flush(); position += count
                Thread.sleep(180)
            }
        }
        fun interrupt() {
            dropped.set(true)
            synchronized(sockets) { for (socket in sockets) { interruptedRequests.incrementAndGet(); runCatching { socket.close() } } }
        }
        override fun close() {
            running.set(false); runCatching { listener.close() }; interrupt(); acceptor.join(2_000)
        }
    }

}
