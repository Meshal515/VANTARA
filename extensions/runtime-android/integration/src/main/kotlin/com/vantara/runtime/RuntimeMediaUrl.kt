package com.vantara.runtime

import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * A CloudStream link exactly as the original engine plays it. It used to be upgraded http→https:443 to fit the
 * player's TLS-only policy, which broke real http-only servers (reference round 1: Akwam http://…downet.net).
 * Owner policy (Nov 6): no refusal or rewrite just for plain http or a port; credentials and private/local addresses
 * stay refused, by addonMediaUrl (NativeAddonMediaNetwork.kt) and the media client's public-address DNS.
 */
internal fun runtimeMediaUrl(value: String): String = value.toHttpUrl().toString()
