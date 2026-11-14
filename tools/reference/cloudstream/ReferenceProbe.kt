package com.lagradost.cloudstream3.utils

/**
 * VANTARA reference measurement (CI only, never shipped): observes each server CloudStream hands to its
 * extractors. Copied into CloudStream's `library` by patch.py; when [listener] is null nothing changes.
 * The unit of comparison in VANTARA's measurement plan is the embed URL passed to loadExtractor.
 */
object ReferenceProbe {
    interface Listener {
        fun embed(url: String, referer: String?)
        fun link(embed: String, referer: String?, link: ExtractorLink)
    }

    @Volatile
    var listener: Listener? = null

    fun wrap(url: String, referer: String?, callback: (ExtractorLink) -> Unit): (ExtractorLink) -> Unit {
        val l = listener ?: return callback
        runCatching { l.embed(url, referer) }
        return { link ->
            runCatching { l.link(url, referer, link) }
            callback(link)
        }
    }
}
