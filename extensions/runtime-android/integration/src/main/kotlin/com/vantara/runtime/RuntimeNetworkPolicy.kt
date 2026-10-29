package com.vantara.runtime

import dev.vantara.runtime.http.HttpBroker
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Reviewed dependency origins belong to exact archive bytes, never a display name.
 * Updated/unreviewed packages retain their declared origin; no wildcard grants. */
internal object RuntimeNetworkPolicy {
    private const val WITCHER="4c639f9392d46e45f4ee84e8799c810cc1d11fba2f13ff7e32865c71987c2fb4"
    @JvmStatic fun sourceOrigins(hash:String,mainUrl:String):Set<String> {
        val url=mainUrl.toHttpUrl()
        require(url.isHttps && url.username.isEmpty() && url.password.isEmpty()) { "INVALID_ENDPOINT" }
        val own=HttpBroker.origin(url)
        return if(hash==WITCHER && own=="https://animewitcher.com")
            setOf(own,"https://d8lh9i7zl7-dsn.algolia.net","https://firestore.googleapis.com")
        else setOf(own)
    }
}
