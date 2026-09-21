package dev.vantara.spike

import java.io.File

/** Durable, append-only report plus a tiny ordered resume checkpoint. */
class ProbeCheckpointStore(root: File) {
    private val report = File(root, "arabic-source-probe-report.txt")
    private val plan = File(root, "arabic-source-probe-plan.txt")
    private val completed = File(root, "arabic-source-probe-completed.txt")
    private val snapshot = File(root, "arabic-source-probe-snapshot.txt")

    /** Never resume or display a report produced by a different source batch. */
    @Synchronized
    fun ensureSnapshot(snapshotKey: String) {
        val current = snapshot.takeIf { it.isFile }?.readText(Charsets.UTF_8)?.trim()
        if (current == snapshotKey) return
        clearData()
        rootReady()
        atomicWrite(snapshot, "$snapshotKey\n")
    }

    @Synchronized
    fun reset(sourceKeys: List<String>) {
        rootReady()
        atomicWrite(plan, sourceKeys.distinct().joinToString(separator = "\n", postfix = "\n"))
        atomicWrite(completed, "")
        atomicWrite(report, "")
    }

    @Synchronized
    fun appendLine(line: String) {
        rootReady()
        report.appendText(line + "\n", Charsets.UTF_8)
    }

    @Synchronized
    fun readReport(): String = report.takeIf { it.isFile }?.readText(Charsets.UTF_8).orEmpty()

    @Synchronized
    fun remaining(): List<String> {
        val done = completed.readLinesSafe().toHashSet()
        return plan.readLinesSafe().filterNot { it in done }
    }

    @Synchronized
    fun markCompleted(sourceKey: String) {
        val done = LinkedHashSet(completed.readLinesSafe())
        if (done.add(sourceKey)) atomicWrite(completed, done.joinToString(separator = "\n", postfix = "\n"))
    }

    @Synchronized
    fun hasCheckpoint(): Boolean = plan.isFile && remaining().isNotEmpty()

    /** A plan can exist with no pending sources if the process died after the final mark. */
    @Synchronized
    fun hasPlan(): Boolean = plan.isFile

    @Synchronized
    fun finish() {
        plan.delete()
        completed.delete()
    }

    @Synchronized
    fun clear() {
        clearData()
    }

    private fun clearData() {
        report.delete()
        plan.delete()
        completed.delete()
    }

    private fun rootReady() {
        report.parentFile?.mkdirs()
    }

    private fun File.readLinesSafe(): List<String> =
        takeIf { it.isFile }?.readLines(Charsets.UTF_8)?.map(String::trim)?.filter(String::isNotEmpty).orEmpty()

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
