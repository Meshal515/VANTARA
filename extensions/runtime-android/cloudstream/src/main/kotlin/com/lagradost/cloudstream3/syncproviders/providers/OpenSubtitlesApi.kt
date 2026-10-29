package com.lagradost.cloudstream3.syncproviders.providers

/** Only the public request headers some providers reuse; no OpenSubtitles account or key is exposed. */
class OpenSubtitlesApi {
    companion object {
        val headers:Map<String,String> get()=mapOf("Accept" to "application/json","User-Agent" to "VANTARA v1")
    }
}
