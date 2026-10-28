package com.vantara.plugins

/** Small process-local LRU; missing/oversized icons are cached too. */
internal class NativeIconCache(private val maxEntries: Int = 64, private val maxChars: Int = 3 * 1024 * 1024) {
    private val values = LinkedHashMap<String, String?>(16, 0.75f, true)
    private var chars = 0

    @Synchronized fun getOrPut(key: String, produce: () -> String?): String? {
        if (values.containsKey(key)) return values[key]
        val value = produce()?.takeIf { it.length <= maxChars }
        values[key] = value
        chars += value?.length ?: 0
        while (values.size > maxEntries || chars > maxChars) {
            val first = values.entries.iterator()
            chars -= first.next().value?.length ?: 0
            first.remove()
        }
        return value
    }
}
