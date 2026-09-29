package com.vantara.usage

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

@Serializable
data class UsageOwner(val userId: String, val section: String, val seriesRef: String, val title: String, val coverUrl: String?)
@Serializable
data class UsageCredit(val id: String, val owner: UsageOwner, val day: String, val activeMs: Long)
@Serializable
private data class JournalState(val ready: List<UsageCredit> = emptyList(), val pending: List<UsageCredit> = emptyList())

/** Durable, account-bound handoff. Exported rows never change until acknowledged. */
class UsageJournal(private val file: File) {
    private val json = Json { ignoreUnknownKeys = true }
    private var state = if (file.exists()) json.decodeFromString<JournalState>(file.readText()) else JournalState()

    private fun save(next: JournalState) {
        file.parentFile?.mkdirs()
        val temp = File(file.path + ".tmp")
        FileOutputStream(temp).use { out ->
            out.write(json.encodeToString(next).toByteArray(Charsets.UTF_8))
            out.fd.sync()
        }
        Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        state = next
    }

    @Synchronized fun credit(owner: UsageOwner, ms: Long, wallNow: Long) {
        if (ms <= 0 || owner.userId.isBlank() || owner.seriesRef.isBlank()) return
        val ready = state.ready.toMutableList()
        val pending = state.pending.toMutableList()
        var left = ms
        var wall = wallNow - ms
        while (left > 0) {
            val date = Instant.ofEpochMilli(wall).atZone(ZoneOffset.UTC).toLocalDate()
            val day = date.toString()
            val midnight = date.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            val index = pending.indexOfFirst { it.owner == owner && it.day == day }
            val old = if (index >= 0) pending.removeAt(index) else UsageCredit(UUID.randomUUID().toString(), owner, day, 0)
            val amount = minOf(left, 60_000 - old.activeMs, midnight - wall)
            val next = old.copy(activeMs = old.activeMs + amount)
            if (next.activeMs == 60_000L) ready += next else pending += next
            left -= amount
            wall += amount
        }
        save(JournalState(ready, pending))
    }

    @Synchronized fun peek(userId: String): List<UsageCredit> {
        val mine = state.pending.filter { it.owner.userId == userId }
        if (mine.isNotEmpty()) save(JournalState(state.ready + mine, state.pending - mine.toSet()))
        return state.ready.filter { it.owner.userId == userId }.take(100)
    }

    @Synchronized fun ack(userId: String, ids: Set<String>) {
        save(state.copy(ready = state.ready.filterNot { it.owner.userId == userId && it.id in ids }))
    }
}
