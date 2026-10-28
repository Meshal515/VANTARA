package dev.vantara.runtime.cloudstream

import okhttp3.*
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Per-process capability. Worker installation never exposes the host controller. */
object NetworkBridge {
    @Volatile private var exchange:((Request,Boolean)->Response)?=null
    private val serialization=Any()
    fun install(transport:(Request,Boolean)->Response){check(exchange==null){"Network already installed"};exchange=transport}
    fun reset(){synchronized(serialization){exchange=null}}
    fun interceptor():Interceptor=BrokerTerminal()
    private class BrokerTerminal:Interceptor {
        override fun intercept(chain:Interceptor.Chain):Response {
            // This profile pins OkHttp5.3.2. Read the call's actual client so a
            // provider's newBuilder redirect/timeout flags are not lost.
            val client=try{chain.call().javaClass.getMethod("getClient").invoke(chain.call()) as OkHttpClient}
                catch(e:ReflectiveOperationException){throw IOException("UNSUPPORTED_HTTP_CLIENT_ABI")}
            if(client.networkInterceptors.isNotEmpty())throw IOException("NETWORK_INTERCEPTOR_CAPABILITY_UNSUPPORTED")
            val index=client.interceptors.indexOf(this)
            if(index<0)throw IOException("BROKER_INTERCEPTOR_MISSING")
            val after=client.interceptors.drop(index+1)
            return Tail(chain,client,after,0,chain.request()).proceed(chain.request())
        }
    }
    private class Tail(private val original:Interceptor.Chain,private val client:OkHttpClient,private val interceptors:List<Interceptor>,private val index:Int,private val current:Request):Interceptor.Chain {
        override fun request()=current
        override fun call()=original.call()
        override fun connection():Connection?=null
        override fun connectTimeoutMillis()=original.connectTimeoutMillis()
        override fun readTimeoutMillis()=original.readTimeoutMillis()
        override fun writeTimeoutMillis()=original.writeTimeoutMillis()
        override fun withConnectTimeout(timeout:Int,unit:TimeUnit):Interceptor.Chain=Tail(original.withConnectTimeout(timeout,unit),client,interceptors,index,current)
        override fun withReadTimeout(timeout:Int,unit:TimeUnit):Interceptor.Chain=Tail(original.withReadTimeout(timeout,unit),client,interceptors,index,current)
        override fun withWriteTimeout(timeout:Int,unit:TimeUnit):Interceptor.Chain=Tail(original.withWriteTimeout(timeout,unit),client,interceptors,index,current)
        override fun proceed(request:Request):Response {
            if(index<interceptors.size)return interceptors[index].intercept(Tail(original,client,interceptors,index+1,request))
            val ready=exchange?:throw IOException("BROKER_NOT_INSTALLED")
            val cookies=client.cookieJar.loadForRequest(request.url)
            val outgoing=if(cookies.isEmpty())request else request.newBuilder().header("Cookie",cookies.joinToString("; "){it.name+"="+it.value}).build()
            val response=synchronized(serialization){if(call().isCanceled())throw IOException("Cancelled");ready(outgoing,client.followRedirects)}
            client.cookieJar.saveFromResponse(response.request.url,Cookie.parseAll(response.request.url,response.headers))
            return response
        }
    }
}
