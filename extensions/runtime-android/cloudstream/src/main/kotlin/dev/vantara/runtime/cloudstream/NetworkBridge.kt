package dev.vantara.runtime.cloudstream

import okhttp3.*
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Per-process capability. Worker installation never exposes the host controller. */
object NetworkBridge {
    private class Generation(val exchange:(Request,Boolean)->Response)
    private val admission=Object()
    private var generation:Generation?=null
    // Match AndroidRuntimeClient's six HTTP transactions per worker and the broker's
    // six per host. The host additionally enforces eight requests across workers.
    private const val MAX_ACTIVE=6
    private const val MAX_PER_HOST=6
    private var active=0
    private val hosts=mutableMapOf<String,Int>()
    fun install(transport:(Request,Boolean)->Response){synchronized(admission){check(generation==null){"Network already installed"};generation=Generation(transport)}}
    fun reset(){synchronized(admission){generation=null;admission.notifyAll()}}
    fun interceptor():Interceptor=BrokerTerminal()
    /**
     * Called at the start of every OkHttpClient.Builder.build() in the Debug runtime APK (a build-time hook on OkHttp,
     * android/app/build.gradle). Inside an isolated worker a provider that builds its own client (WitAnime: its own
     * TLS settings and cookie jar) had no network at all and failed before its first request; now every client it
     * builds ends in this broker, with the same DNS, SNI, origin and verification policy as CloudStream's own `app`.
     * Outside a worker no bridge is installed and this does nothing (the host app's clients are untouched).
     */
    @JvmStatic fun adopt(builder:OkHttpClient.Builder) {
        if(synchronized(admission){generation==null})return
        if(builder.interceptors().any{it is BrokerTerminal})return
        builder.addInterceptor(BrokerTerminal())
    }
    private fun current():Generation=synchronized(admission){generation?:throw IOException("BROKER_NOT_INSTALLED")}
    private fun checkCurrent(expected:Generation,call:Call){
        if(generation!==expected)throw IOException("BROKER_RESET")
        if(call.isCanceled()||Thread.currentThread().isInterrupted)throw IOException("Cancelled")
    }
    private fun acquire(expected:Generation,call:Call,host:String){synchronized(admission){
        while(true){
            checkCurrent(expected,call)
            if(active<MAX_ACTIVE&&(hosts[host]?:0)<MAX_PER_HOST){active++;hosts[host]=(hosts[host]?:0)+1;return}
            // Call.cancel has no notification hook on an application interceptor.
            // Poll only queued admission; the blocking Binder exchange runs outside this lock.
            try{admission.wait(25)}catch(error:InterruptedException){Thread.currentThread().interrupt();throw IOException("Cancelled",error)}
        }
    }}
    private fun release(host:String){synchronized(admission){
        active--;val count=hosts.getValue(host)-1
        if(count==0)hosts.remove(host)else hosts[host]=count
        admission.notifyAll()
    }}
    private fun exchange(expected:Generation,call:Call,client:OkHttpClient,request:Request):Response {
        val host=request.url.host
        acquire(expected,call,host)
        var response:Response?=null
        try{
            val cookies=client.cookieJar.loadForRequest(request.url)
            val outgoing=if(cookies.isEmpty())request else request.newBuilder().header("Cookie",cookies.joinToString("; "){it.name+"="+it.value}).build()
            synchronized(admission){checkCurrent(expected,call)}
            response=expected.exchange(outgoing,client.followRedirects)
            synchronized(admission){checkCurrent(expected,call)}
            // Provider code can block. Never hold global admission/reset bookkeeping
            // while persisting cookies. A save already begun cannot be revoked by the
            // CookieJar API; reset still rejects/closes the response afterwards.
            client.cookieJar.saveFromResponse(response.request.url,Cookie.parseAll(response.request.url,response.headers))
            synchronized(admission){checkCurrent(expected,call)}
            return response
        }catch(failure:Throwable){
            try{response?.close()}catch(closeFailure:Throwable){failure.addSuppressed(closeFailure)}
            synchronized(admission){checkCurrent(expected,call)}
            throw failure
        }finally{release(host)}
    }
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
            return Tail(chain,client,current(),after,0,chain.request()).proceed(chain.request())
        }
    }
    private class Tail(private val original:Interceptor.Chain,private val client:OkHttpClient,private val generation:Generation,private val interceptors:List<Interceptor>,private val index:Int,private val current:Request):Interceptor.Chain {
        override fun request()=current
        override fun call()=original.call()
        override fun connection():Connection?=null
        override fun connectTimeoutMillis()=original.connectTimeoutMillis()
        override fun readTimeoutMillis()=original.readTimeoutMillis()
        override fun writeTimeoutMillis()=original.writeTimeoutMillis()
        override fun withConnectTimeout(timeout:Int,unit:TimeUnit):Interceptor.Chain=Tail(original.withConnectTimeout(timeout,unit),client,generation,interceptors,index,current)
        override fun withReadTimeout(timeout:Int,unit:TimeUnit):Interceptor.Chain=Tail(original.withReadTimeout(timeout,unit),client,generation,interceptors,index,current)
        override fun withWriteTimeout(timeout:Int,unit:TimeUnit):Interceptor.Chain=Tail(original.withWriteTimeout(timeout,unit),client,generation,interceptors,index,current)
        override fun proceed(request:Request):Response {
            if(index<interceptors.size)return interceptors[index].intercept(Tail(original,client,generation,interceptors,index+1,request))
            return exchange(generation,call(),client,request)
        }
    }
}
