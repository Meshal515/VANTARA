package dev.vantara.spike

import java.io.File
import java.security.MessageDigest

/**
 * Page-level durable checkpoint for the long catalogue crawl.
 *
 * The old spike only checkpointed whole packages in the health probe. The
 * catalogue crawl had no checkpoint at all, so process death restarted at page
 * 1 and discarded every discovered work. This store commits after every
 * successful page. If Android kills the process between two commits, at worst
 * one page is repeated.
 */
class CatalogueCrawlCheckpointStore(root: File) {
    data class Resume(
        val nextPage: Int,
        val seenKeys: Set<String>,
    )

    private val dir = File(root, "catalogue-crawl")
    private val completed = File(dir, "completed.txt")
    private val snapshot = File(dir, "snapshot.txt")

    /** Catalogue pages are only resumable against the exact source batch. */
    @Synchronized
    fun ensureSnapshot(snapshotKey: String) {
        val current = snapshot.takeIf { it.isFile }?.readText(Charsets.UTF_8)?.trim()
        if (current == snapshotKey) return
        dir.deleteRecursively()
        dir.mkdirs()
        atomicWrite(snapshot, "$snapshotKey\n")
    }

    @Synchronized
    fun load(key: String): Resume? {
        val meta = metaFile(key)
        if (!meta.isFile) return null
        val lines = meta.readLinesSafe()
        if (lines.size < 2 || lines[0] != key) return null
        val nextPage = lines[1].toIntOrNull()?.coerceAtLeast(1) ?: return null
        return Resume(
            nextPage = nextPage,
            seenKeys = seenFile(key).readLinesSafe().toSet(),
        )
    }

    /**
     * Commit one fetched page.
     *
     * Seen keys are appended before advancing nextPage. If the process dies
     * between those writes, the same page is fetched again and the Set removes
     * duplicates; no work is lost.
     */
    @Synchronized
    fun savePage(key: String, nextPage: Int, newKeys: Collection<String>) {
        dir.mkdirs()
        if (newKeys.isNotEmpty()) {
            seenFile(key).appendText(
                newKeys.joinToString(separator = "\n", postfix = "\n"),
                Charsets.UTF_8,
            )
        }
        atomicWrite(metaFile(key), "$key\n${nextPage.coerceAtLeast(1)}\n")
    }

    @Synchronized
    fun markComplete(key: String) {
        dir.mkdirs()
        val done = LinkedHashSet(completed.readLinesSafe())
        if (done.add(key)) atomicWrite(completed, done.joinToString(separator = "\n", postfix = "\n"))
        metaFile(key).delete()
        seenFile(key).delete()
    }

    @Synchronized
    fun isComplete(key: String): Boolean = key in completed.readLinesSafe().toHashSet()

    /** True only when a source has a page-level state that can actually resume. */
    @Synchronized
    fun hasResumeState(): Boolean =
        dir.listFiles()?.any { it.isFile && it.name.startsWith("state-") && it.name.endsWith(".txt") } == true

    /** Includes sources already completed before a process death between sources. */
    @Synchronized
    fun hasAnyProgress(): Boolean =
        hasResumeState() || completed.readLinesSafe().isNotEmpty()

    @Synchronized
    fun clear() {
        dir.listFiles()
            ?.filterNot { it == snapshot }
            ?.forEach { it.deleteRecursively() }
    }

    private fun metaFile(key: String) = File(dir, "state-${digest(key)}.txt")
    private fun seenFile(key: String) = File(dir, "seen-${digest(key)}.txt")

    private fun digest(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
            .take(24)

    private fun File.readLinesSafe(): List<String> =
        takeIf { it.isFile }
            ?.readLines(Charsets.UTF_8)
            ?.map(String::trim)
            ?.filter(String::isNotEmpty)
            .orEmpty()

    private fun atomicWrite(target: File, value: String) {
        target.parentFile?.mkdirs()
        val temporary = File(target.parentFile, target.name + ".tmp")
        temporary.writeText(value, Charsets.UTF_8)
        if (!temporary.renameTo(target)) {
            target.writeText(value, Charsets.UTF_8)
            temporary.delete()
        }
    }
}
