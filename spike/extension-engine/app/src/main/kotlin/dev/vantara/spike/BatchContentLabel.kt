package dev.vantara.spike

/** Human-readable content classes actually present in the generated batch. */
fun batchContentLabel(warnings: Set<ContentWarning>): String {
    val ordered = listOf(
        ContentWarning.SAFE to "SAFE",
        ContentWarning.MIXED to "MIXED",
        ContentWarning.NSFW to "NSFW",
    ).filter { (warning, _) -> warning in warnings }.map { it.second }

    return if (ordered == listOf("SAFE")) "SAFE فقط" else ordered.joinToString(" + ")
}
