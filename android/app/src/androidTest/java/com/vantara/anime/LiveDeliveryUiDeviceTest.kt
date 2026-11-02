package com.vantara.anime

import android.app.Instrumentation
import android.content.Intent
import android.os.SystemClock
import android.util.AtomicFile
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import com.vantara.anime.player.PlayerActivity
import com.vantara.anime.registry.UserAnimeState
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.PreparedEpisode
import com.vantara.anime.stream.RouteState
import com.vantara.plugins.UserExtensionState
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.DataInputStream
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicReference

/**
 * ADB/CDP handshake around real WebView interactions. This observer never prepares
 * a stream, starts a player, changes its media, or writes installation state.
 * Select exactly one method per instrumentation process; restart requires an
 * actual force-stop between the methods. See ready/command/response in filesDir.
 */
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
class LiveDeliveryUiDeviceTest {
    private val ins: Instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val files: File get() = ins.targetContext.filesDir
    private val output: File get() = File(files, "debug-ui-delivery")
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun freshUiJourney(): Unit = journey(restart = false)

    @Test fun restartUiJourney(): Unit = journey(restart = true)

    private fun journey(restart: Boolean) {
        require(com.vantara.app.BuildConfig.DEBUG && ins.targetContext.packageName.endsWith(".debug") &&
            InstrumentationRegistry.getArguments().getString("vantaraEphemeralDelivery") == "true") { "EPHEMERAL_DELIVERY_DEBUG_REQUIRED" }
        output.mkdirs()
        val checkpointFile = File(output, "checkpoint.json")
        val phase = if (restart) "restart" else "fresh"
        val previous = if (restart) {
            require(checkpointFile.isFile) { "UI_DELIVERY_CHECKPOINT_REQUIRED" }
            JSONObject(checkpointFile.readText()).also { checkpoint ->
                assertNotEquals("Restart must use a new app process", checkpoint.getInt("pid"), android.os.Process.myPid())
                assertInventoryEquals(checkpoint.getJSONObject("inventory"), inventory())
            }
        } else {
            require(!checkpointFile.exists()) { "FRESH_EPHEMERAL_APP_REQUIRED" }
            requireEmptyInstallations()
            null
        }
        // Dedicated handshake files only. User repositories, packages and accounts are untouched.
        listOf("command.json", "response.json", "ready.json").forEach { File(output, it).delete() }
        ins.startActivitySync(Intent(ins.targetContext, com.vantara.app.MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        write("ready.json", JSONObject().put("pid", android.os.Process.myPid()).put("phase", phase)
            .put("protocol", 1).put("functionalOnly", true).apply {
                previous?.let { put("restartedFromPid", it.getInt("pid")); put("durability", "PASS") }
            })

        val end = SystemClock.elapsedRealtime() + 20 * 60_000L
        var lastCommandAt = SystemClock.elapsedRealtime()
        val seen = HashSet<String>()
        val observations = JSONArray()
        val failures = mutableListOf<String>()
        while (SystemClock.elapsedRealtime() < end) {
            val command = readCommand()
            val id = command?.optString("id").orEmpty()
            if (command == null || id.isBlank() || !seen.add(id)) {
                check(SystemClock.elapsedRealtime() - lastCommandAt < 5 * 60_000L) { "UI_DELIVERY_COMMAND_IDLE_TIMEOUT" }
                SystemClock.sleep(200)
                continue
            }
            lastCommandAt = SystemClock.elapsedRealtime()
            val response = JSONObject().put("id", id).put("pid", android.os.Process.myPid()).put("phase", phase)
            when (command.optString("action")) {
                "ping" -> write("response.json", response.put("status", "PASS").put("observation", false))
                "observe" -> {
                    try {
                        val facts = observe(command, minOf(end, SystemClock.elapsedRealtime() + 50_000L))
                        observations.put(JSONObject().put("id", id).put("facts", facts))
                        response.put("status", "PASS").put("facts", facts)
                    } catch (error: Throwable) {
                        val detail = failureCode(error)
                        failures += "$id:$detail"
                        response.put("status", "FAIL").put("error", detail)
                    }
                    write("response.json", response)
                }
                "finish" -> {
                    try {
                        check(observations.length() > 0) { "NO_REAL_UI_PLAYBACK_OBSERVATIONS" }
                        check(failures.isEmpty()) { "UI_OBSERVATIONS_FAILED:${failures.joinToString(";")}" }
                        val current = inventory()
                        previous?.let { assertInventoryEquals(it.getJSONObject("inventory"), current) }
                        if (!restart) write("checkpoint.json", JSONObject().put("pid", android.os.Process.myPid())
                            .put("inventory", current).put("observations", observations))
                        response.put("status", "PASS").put("observations", observations.length())
                            .put("functionalOnly", true).put("inventory", current)
                        write("response.json", response)
                        return
                    } catch (error: Throwable) {
                        write("response.json", response.put("status", "FAIL").put("error", failureCode(error)))
                        throw error
                    }
                }
                else -> {
                    failures += "$id:UNKNOWN_COMMAND"
                    write("response.json", response.put("status", "FAIL").put("error", "UNKNOWN_COMMAND"))
                }
            }
        }
        error("UI_DELIVERY_TOTAL_TIMEOUT")
    }

    private data class Snapshot(
        val activity: PlayerActivity,
        val session: String,
        val launch: PlayerActivity.Launch,
        val candidate: Candidate?,
        val prep: PreparedEpisode?,
        val mediaUrl: String?,
        val position: Long,
        val rendered: Int,
        val dropped: Int,
        val playing: Boolean,
        val error: String?,
        val width: Int?,
        val height: Int?,
    )

    private fun snapshot(): Snapshot? = onMain {
        val activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)
            .filterIsInstance<PlayerActivity>().singleOrNull() ?: return@onMain null
        fun field(name: String): Any? = PlayerActivity::class.java.getDeclaredField(name).apply { isAccessible = true }.get(activity)
        val player = field("player") as? ExoPlayer ?: return@onMain null
        val launch = field("launch") as? PlayerActivity.Launch ?: return@onMain null
        val session = field("sessionId") as? String ?: return@onMain null
        Snapshot(activity, session, launch, field("current") as? Candidate,
            field("prep") as? PreparedEpisode, player.currentMediaItem?.localConfiguration?.uri?.toString(),
            player.currentPosition, player.videoDecoderCounters?.renderedOutputBufferCount ?: 0,
            player.videoDecoderCounters?.droppedBufferCount ?: 0, player.isPlaying,
            player.playerError?.errorCodeName, player.videoFormat?.width, player.videoFormat?.height)
    }

    private fun observe(command: JSONObject, deadline: Long): JSONObject {
        val expectedSession = command.getString("session").also { require(it.isNotBlank()) }
        val expectedSource = command.getString("sourceId").also { require(it.isNotBlank()) }
        var first: Snapshot? = null
        while (SystemClock.elapsedRealtime() < deadline - 5_000) {
            val current = snapshot()
            if (current != null) {
                // A bridge openPlayer resolution can precede the activity resume.
                if (current.session != expectedSession) { SystemClock.sleep(100); continue }
                check(current.error == null) { "PLAYER_ERROR:${current.error}" }
                check(current.session == expectedSession && current.launch.session == expectedSession &&
                    current.activity.intent.getStringExtra(PlayerActivity.EXTRA_SESSION) == expectedSession) { "ACTUAL_PLAYER_SESSION_MISMATCH" }
                if (current.candidate != null) validateSelection(command, current, expectedSource)
                if (current.candidate != null && current.playing && current.rendered > 0) { first = current; break }
            }
            SystemClock.sleep(100)
        }
        val start = first ?: error("REAL_UI_PLAYER_DID_NOT_DECODE")
        val began = SystemClock.elapsedRealtime()
        var last = start
        while (SystemClock.elapsedRealtime() - began < 5_000) {
            check(SystemClock.elapsedRealtime() < deadline) { "OBSERVATION_TIMEOUT" }
            last = snapshot() ?: error("UI_PLAYER_NOT_RESUMED")
            check(last.activity === start.activity && last.session == expectedSession) { "UI_PLAYER_CHANGED_DURING_OBSERVATION" }
            check(last.error == null) { "PLAYER_ERROR:${last.error}" }
            validateSelection(command, last, expectedSource)
            check(last.candidate?.id == start.candidate?.id) { "PLAYER_FELL_BACK_DURING_OBSERVATION" }
            SystemClock.sleep(100)
        }
        val advanced = last.position - start.position
        val rendered = last.rendered - start.rendered
        assertTrue("Functional playback advanced ${advanced}ms; requires 1500ms in five seconds", advanced >= 1_500)
        assertTrue("Functional playback decoded $rendered frames; requires 20", rendered >= 20)
        assertTrue("Observed player stopped", last.playing)
        val candidate = requireNotNull(last.candidate)
        val route = requireNotNull(last.prep?.routeOf(candidate.id))
        return JSONObject().put("session", last.session).put("sourceId", candidate.sourceId)
            .put("candidate", candidate.id).put("route", route.id).put("probed", route.probed)
            .put("episode", last.launch.episode.toDouble()).put("mediaScheme", java.net.URI(candidate.url).scheme)
            .put("mediaUrlSha256", sha(candidate.url.toByteArray())).put("advancedMs", advanced)
            .put("decodedFrames", rendered).put("droppedFrames", last.dropped - start.dropped)
            .put("sampleMs", SystemClock.elapsedRealtime() - began).put("width", last.width).put("height", last.height)
            .put("functionalOnly", true).put("smoothnessCertified", false)
    }

    private fun validateSelection(command: JSONObject, snapshot: Snapshot, expectedSource: String) {
        val candidate = requireNotNull(snapshot.candidate)
        check(candidate.sourceId == expectedSource) { "ACTUAL_PLAYER_SOURCE_MISMATCH" }
        check(java.net.URI(candidate.url).scheme in setOf("https", "http")) { "REAL_HTTP_MEDIA_REQUIRED" }
        check(snapshot.mediaUrl == candidate.url) { "PLAYER_MEDIA_DOES_NOT_MATCH_SELECTED_CANDIDATE" }
        val prep = requireNotNull(snapshot.prep) { "PREPARED_UI_SESSION_REQUIRED" }
        check(AnimeEngine.get(ins.targetContext).prepared(snapshot.session) === prep) { "PREPARED_SESSION_REPLACED" }
        val route = requireNotNull(prep.routeOf(candidate.id)) { "ACTUAL_PLAYER_ROUTE_MISSING" }
        check(route.sourceId == expectedSource) { "ACTUAL_ROUTE_SOURCE_MISMATCH" }
        check(prep.probe && route.probed == true && route.state == RouteState.READY) { "HTTP_ROUTE_NOT_PROBED_READY" }
        if (command.has("candidate")) check(command.getString("candidate") == candidate.id &&
            snapshot.launch.candidate == candidate.id) { "ACTUAL_PLAYER_CANDIDATE_MISMATCH" }
        if (command.has("route")) check(command.getString("route") == route.id) { "ACTUAL_PLAYER_ROUTE_MISMATCH" }
        if (command.has("addonGeneration")) check(command.getString("addonGeneration") == prep.addonGeneration) { "ACTUAL_PLAYER_GENERATION_MISMATCH" }
        if (command.has("episode")) check(kotlin.math.abs(command.getDouble("episode") - snapshot.launch.episode) < .001 &&
            kotlin.math.abs(command.getDouble("episode") - prep.number) < .001) { "ACTUAL_PLAYER_EPISODE_MISMATCH" }
    }

    private fun requireEmptyInstallations() {
        listOf("extensions/user-repos.json", "anime-extensions/user-repos.json").forEach { path ->
            val file = File(files, path)
            require(!file.exists() || (JSONObject(file.readText()).optJSONArray("extensions")?.length() ?: 0) == 0) { "EXISTING_USER_INSTALLATIONS_REFUSED" }
        }
        require(runtimeReceipts().isEmpty()) { "EXISTING_RUNTIME_INSTALLATIONS_REFUSED" }
    }

    /** Hash only durable installation receipts/immutable package objects, never cookies or credentials. */
    private fun inventory(): JSONObject {
        val hashes = JSONObject()
        val sourceIds = sortedSetOf<String>()
        val packages = JSONArray()
        fun record(file: File, expected: String? = null) {
            check(file.isFile) { "INSTALLED_OBJECT_MISSING:${file.relativeTo(files).path}" }
            val digest = file.inputStream().use { input ->
                val md = MessageDigest.getInstance("SHA-256"); val bytes = ByteArray(8192)
                while (true) { val n = input.read(bytes); if (n < 0) break; md.update(bytes, 0, n) }
                md.digest().joinToString("") { "%02x".format(it) }
            }
            check(expected == null || digest.equals(expected, true)) { "INSTALLED_OBJECT_HASH_MISMATCH" }
            hashes.put(file.relativeTo(files).path, digest)
        }
        val mangaFile = File(files, "extensions/user-repos.json")
        check(mangaFile.isFile) { "MANGA_INSTALLATION_RECEIPT_REQUIRED" }
        val manga = json.decodeFromString(UserExtensionState.serializer(), mangaFile.readText())
        check(manga.extensions.isNotEmpty()) { "MANGA_INSTALLATION_REQUIRED" }; record(mangaFile)
        for (ext in manga.extensions) {
            record(File(files, "extensions/vault/${ext.pkg}/${ext.sha256.lowercase()}.apk"), ext.sha256)
            ext.sources.forEach { sourceIds += "${ext.pkg}#${it.id}" }
            packages.put(JSONObject().put("family", "manga").put("pkg", ext.pkg))
        }
        val animeFile = File(files, "anime-extensions/user-repos.json")
        check(animeFile.isFile) { "ANIYOMI_INSTALLATION_RECEIPT_REQUIRED" }
        val anime = json.decodeFromString(UserAnimeState.serializer(), animeFile.readText())
        check(anime.extensions.isNotEmpty()) { "ANIYOMI_INSTALLATION_REQUIRED" }; record(animeFile)
        for (ext in anime.extensions) {
            record(File(files, "anime-extensions/vault/${ext.pkg}/${ext.sha256.lowercase()}.apk"), ext.sha256)
            sourceIds += ext.entries().map { it.id }
            packages.put(JSONObject().put("family", "aniyomi").put("pkg", ext.pkg))
        }
        val runtime = runtimeReceipts()
        check(runtime.isNotEmpty()) { "CLOUDSTREAM_INSTALLATION_REQUIRED" }
        for (receipt in runtime) DataInputStream(receipt.inputStream()).use { input ->
            check(input.readInt() == 0x56525031) { "RUNTIME_RECEIPT_INVALID" }
            val pkg = input.readUTF(); val archiveHash = input.readUTF(); val dexHash = input.readUTF()
            input.readUTF(); input.readInt()
            val metadata = JSONObject(input.readUTF())
            record(receipt)
            val accountRoot = requireNotNull(receipt.parentFile?.parentFile)
            val objectRoot = File(accountRoot, "objects/$archiveHash")
            record(File(objectRoot, "original.cs3"), archiveHash); record(File(objectRoot, "classes.dex"), dexHash)
            val sources = metadata.getJSONObject("registration").getJSONArray("sources")
            check(sources.length() > 0) { "RUNTIME_SOURCE_IDENTITIES_REQUIRED" }
            for (i in 0 until sources.length()) sourceIds += "addon|cs3|$pkg|${sha(sources.getJSONObject(i).getString("name").toByteArray()).take(24)}|u${accountRoot.name.take(24)}"
            packages.put(JSONObject().put("family", "cloudstream").put("pkg", pkg))
        }
        return JSONObject().put("files", hashes).put("sourceIds", JSONArray(sourceIds.toList())).put("packages", packages)
    }

    private fun runtimeReceipts(): List<File> = File(files, "runtime-cloudstream-v1/packages")
        .takeIf { it.isDirectory }?.walkTopDown()?.maxDepth(3)?.filter { it.isFile && it.extension == "vri" && it.parentFile?.name == "installed" }
        ?.take(513)?.toList().orEmpty().also { require(it.size <= 512) { "RUNTIME_RECEIPT_LIMIT" } }

    private fun assertInventoryEquals(expected: JSONObject, actual: JSONObject) {
        val before = expected.getJSONObject("files"); val after = actual.getJSONObject("files")
        assertEquals("Installed receipt/object set changed on restart", before.keys().asSequence().toSet(), after.keys().asSequence().toSet())
        for (key in before.keys()) assertEquals("Durable installed bytes changed: $key", before.getString(key), after.getString(key))
        fun ids(value: JSONObject) = value.getJSONArray("sourceIds").let { rows -> (0 until rows.length()).map { rows.getString(it) }.toSet() }
        assertEquals("Durable source identities changed on restart", ids(expected), ids(actual))
    }

    private fun readCommand(): JSONObject? = File(output, "command.json").takeIf { it.isFile && it.length() <= 65_536 }
        ?.let { runCatching { JSONObject(it.readText()) }.getOrNull() }

    private fun write(name: String, value: JSONObject) {
        val atomic = AtomicFile(File(output, name)); val stream = atomic.startWrite()
        try { stream.write(value.toString().toByteArray()); atomic.finishWrite(stream) }
        catch (error: Throwable) { atomic.failWrite(stream); throw error }
    }

    private fun <T> onMain(read: () -> T): T {
        val result = AtomicReference<T>(); ins.runOnMainSync { result.set(read()) }; return result.get()
    }

    private fun sha(value: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it) }
    private fun failureCode(error: Throwable): String = "${error.javaClass.simpleName}:${error.message.orEmpty().take(1000)}"
}
