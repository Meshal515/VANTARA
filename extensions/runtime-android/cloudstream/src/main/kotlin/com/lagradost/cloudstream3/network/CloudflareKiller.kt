package com.lagradost.cloudstream3.network

import dev.vantara.runtime.cloudstream.WorkerState
import okhttp3.Headers
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Providers attach this to requests behind Cloudflare. The isolated worker cannot open a WebView, so the
 * challenge itself is solved by VANTARA's explicit verification flow in the host; this interceptor only
 * adds the clearance cookies that flow stored for the same host, then lets the broker report a challenge.
 */
class CloudflareKiller:Interceptor {
    val savedCookies:Map<String,Map<String,String>> get()=WorkerState.clearanceCookies()
    fun getCookieHeaders(url:String):Headers {
        val host=runCatching{java.net.URI(url).host}.getOrNull()?:return Headers.headersOf()
        val cookies=savedCookies[host]?:return Headers.headersOf()
        return Headers.headersOf("Cookie",cookies.entries.joinToString("; "){it.key+"="+it.value})
    }
    override fun intercept(chain:Interceptor.Chain):Response {
        val request=chain.request()
        val cookie=getCookieHeaders(request.url.toString())["Cookie"]
        return chain.proceed(if(cookie==null||request.header("Cookie")!=null)request else request.newBuilder().header("Cookie",cookie).build())
    }
}
