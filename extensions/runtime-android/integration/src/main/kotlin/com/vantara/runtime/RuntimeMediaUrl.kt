package com.vantara.runtime

import okhttp3.HttpUrl.Companion.toHttpUrl

/** CloudStream compatibility only: keep the existing player's HTTPS/public-host policy intact.
 * No cleartext fallback, credential stripping, alternate port or relaxed TLS validation.
 */
internal fun runtimeMediaUrl(value: String): String {
    val url=value.toHttpUrl()
    return if(url.scheme=="http" && url.port==80 && url.username.isEmpty() && url.password.isEmpty())
        url.newBuilder().scheme("https").port(443).build().toString()
    else url.toString()
}
