package com.vantara.anime

object DiscoveryFailure {
    private fun safe(value: String): String = value
        .replace(Regex("https?://[^\\s\"'<>]+", RegexOption.IGNORE_CASE), "[url]")
        .replace(Regex("\\b(?:authorization|cookie|set-cookie)\\s*[:=][^\\r\\n]+", RegexOption.IGNORE_CASE), "[redacted header]")
        .replace(Regex("(?:bearer\\s+|(?:token|cookie|password|credential|authorization)\\s*[:=]\\s*)[^\\s,;]+", RegexOption.IGNORE_CASE), "[redacted]")
        .take(1600)

    /** Keep cause classes and call sites; never cookies, request headers or signed URLs. */
    fun describe(error: Throwable): String {
        val seen = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<Throwable, Boolean>())
        val chain = generateSequence(error) { it.cause }.takeWhile { seen.add(it) }.take(32).toList()
        val root = chain.last()
        return "Root cause: " + safe(root.javaClass.name + ": " + root.message.orEmpty()).take(800) + "\n" +
            chain.takeLast(8).joinToString("\nCaused by: ") { cause ->
            safe(cause.javaClass.name + ": " + cause.message.orEmpty()) + "\n" +
                cause.stackTrace.take(12).joinToString("\n") { "  at $it" }
        }
    }
}
