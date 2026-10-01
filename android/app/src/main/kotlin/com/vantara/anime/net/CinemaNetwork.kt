package com.vantara.anime.net

import eu.kanade.tachiyomi.network.HostRouting
import okhttp3.Interceptor
import okhttp3.OkHttpClient

/** Request-scoped policy for Cinema extraction, playback and clips. No host-global state. */
object CinemaNetwork {
    fun client(original: OkHttpClient): OkHttpClient {
        val builder = original.newBuilder()
        builder.interceptors().add(0, Interceptor { chain ->
            chain.proceed(chain.request().newBuilder().tag(HostRouting.NoBrowser::class.java, HostRouting.NoBrowser()).build())
        })
        return builder.build()
    }
}
