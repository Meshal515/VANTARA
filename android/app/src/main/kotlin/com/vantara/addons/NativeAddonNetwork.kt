package com.vantara.addons

import android.content.Context
import com.vantara.anime.AnimeEngine
import eu.kanade.tachiyomi.network.NetworkHelper
import okhttp3.Dns
import okhttp3.EventListener
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get

/** نفس DNS/DoH والـpool والسباق؛ رؤوس/كوكيز المصدر وsolver لا تنتقل للإضافة. */
fun nativeAddonClient(context: Context): RemoteAddonClient {
    val network = Injekt.get<NetworkHelper>()
    val dns = AnimeEngine.get(context).dns
    val builder = network.client.newBuilder()
    builder.interceptors().clear()
    builder.networkInterceptors().clear()
    builder.eventListener(EventListener.NONE)
    builder.dns(Dns { RemoteAddonClient.publicAddresses(dns.lookup(it)) })
    return RemoteAddonClient(builder.build())
}
