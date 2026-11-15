package dev.vantara.runtime.cloudstream

import com.lagradost.nicehttp.Requests
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.buffer
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*

class NetworkBridgeConcurrencyTest {
    private val workers=Executors.newFixedThreadPool(16)
    private val release=CountDownLatch(1)
    private val client=Requests().baseClient
    @After fun cleanup(){release.countDown();workers.shutdown();assertTrue(workers.awaitTermination(5,TimeUnit.SECONDS));NetworkBridge.reset()}
    private fun call(host:String="source.example")=client.newCall(Request.Builder().url("https://$host/").build())
    private fun response(request:Request,closed:AtomicInteger?=null):Response {
        val body=if(closed==null)"ok".toResponseBody() else object:ResponseBody(){
            private val stream=object:ForwardingSource(Buffer().writeUtf8("ok")){override fun close(){closed.incrementAndGet();super.close()}}.buffer()
            override fun contentType():MediaType?=null
            override fun contentLength()=2L
            override fun source():BufferedSource=stream
        }
        return Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body).build()
    }
    private fun execute(call:Call)=workers.submit<String>{call.execute().use{it.body.string()}}
    private fun failure(call:Call)=workers.submit<String>{try{call.execute().use{it.body.string()};"accepted"}catch(error:IOException){error.message?:"IOException"}}
    private fun await(latch:CountDownLatch)=assertTrue("Transport did not enter",latch.await(2,TimeUnit.SECONDS))

    @Test fun slowRequestDoesNotBlockIndependentFastRequest(){
        val entered=CountDownLatch(1)
        NetworkBridge.install{request,_->if(request.url.host=="slow.example"){entered.countDown();release.await()};response(request)}
        val slow=execute(call("slow.example"));await(entered)
        val fast=execute(call("fast.example"))
        try{assertEquals("ok",fast.get(500,TimeUnit.MILLISECONDS))}finally{release.countDown()}
        assertEquals("ok",slow.get(2,TimeUnit.SECONDS))
    }

    @Test fun transportConcurrencyIsBoundedAcrossHosts(){
        val entered=CountDownLatch(6);val active=AtomicInteger();val peak=AtomicInteger();val started=AtomicInteger()
        NetworkBridge.install{request,_->started.incrementAndGet();val current=active.incrementAndGet();peak.accumulateAndGet(current,::maxOf);entered.countDown();try{release.await();response(request)}finally{active.decrementAndGet()}}
        val pending=(0 until 12).map{execute(call("host$it.example"))}
        try{await(entered);assertEquals(6,started.get());assertEquals(6,peak.get())}finally{release.countDown()}
        pending.forEach{assertEquals("ok",it.get(2,TimeUnit.SECONDS))};assertEquals(6,peak.get())
    }

    @Test fun oneHostFanoutQueuesWithinBrokerHostLimit(){
        val entered=CountDownLatch(6);val started=AtomicInteger();val peak=AtomicInteger();val active=AtomicInteger()
        NetworkBridge.install{request,_->started.incrementAndGet();val current=active.incrementAndGet();peak.accumulateAndGet(current,::maxOf);entered.countDown();try{release.await();response(request)}finally{active.decrementAndGet()}}
        val pending=(0 until 10).map{execute(call())}
        try{await(entered);assertEquals(6,started.get())}finally{release.countDown()}
        pending.forEach{assertEquals("ok",it.get(2,TimeUnit.SECONDS))};assertEquals(6,peak.get())
    }

    @Test fun cancellingQueuedCallNeverInvokesTransport(){
        val entered=CountDownLatch(6);val started=AtomicInteger()
        NetworkBridge.install{request,_->started.incrementAndGet();entered.countDown();release.await();response(request)}
        val active=(0 until 6).map{execute(call())}
        try{
            await(entered)
            val queuedEntered=CountDownLatch(1)
            val queued=client.newBuilder().addInterceptor{chain->queuedEntered.countDown();chain.proceed(chain.request())}.build().newCall(Request.Builder().url("https://source.example/").build())
            val result=failure(queued);await(queuedEntered);queued.cancel()
            assertTrue(result.get(500,TimeUnit.MILLISECONDS).contains("Cancel",true));assertEquals(6,started.get())
        }finally{release.countDown()}
        active.forEach{it.get(2,TimeUnit.SECONDS)}
    }

    @Test fun resetReturnsPromptlyAndRejectsOldResponsesWithoutSavingCookies(){
        val entered=CountDownLatch(1);val closed=AtomicInteger();val saved=AtomicInteger()
        val jar=object:CookieJar{override fun loadForRequest(url:HttpUrl)=emptyList<Cookie>();override fun saveFromResponse(url:HttpUrl,cookies:List<Cookie>){saved.incrementAndGet()}}
        val scoped=client.newBuilder().cookieJar(jar).build()
        NetworkBridge.install{request,_->entered.countDown();release.await();response(request,closed)}
        val old=failure(scoped.newCall(Request.Builder().url("https://old.example/").build()));await(entered)
        val reset=workers.submit{NetworkBridge.reset()}
        try{reset.get(500,TimeUnit.MILLISECONDS)}finally{release.countDown()}
        assertEquals("BROKER_RESET",old.get(2,TimeUnit.SECONDS));assertEquals(1,closed.get());assertEquals(0,saved.get())
        NetworkBridge.install{request,_->response(request)}
        assertEquals("ok",execute(call("new.example")).get(2,TimeUnit.SECONDS))
    }

    @Test fun cancellationDuringTransportClosesLateResponse(){
        val entered=CountDownLatch(1);val closed=AtomicInteger()
        NetworkBridge.install{request,_->entered.countDown();release.await();response(request,closed)}
        val active=call();val result=failure(active);await(entered);active.cancel();release.countDown()
        assertTrue(result.get(2,TimeUnit.SECONDS).contains("Cancel",true));assertEquals(1,closed.get())
    }

    @Test fun resetRejectsQueuedCallsInsteadOfSendingThemToReplacementTransport(){
        val entered=CountDownLatch(6);val queuedEntered=CountDownLatch(1);val oldStarts=AtomicInteger();val newStarts=AtomicInteger()
        NetworkBridge.install{request,_->oldStarts.incrementAndGet();entered.countDown();release.await();response(request)}
        val active=(0 until 6).map{failure(call())};await(entered)
        // The appended interceptor places this call inside the bridge before reset.
        val queuedClient=client.newBuilder().addInterceptor{chain->queuedEntered.countDown();chain.proceed(chain.request())}.build()
        val queued=failure(queuedClient.newCall(Request.Builder().url("https://queued.example/").build()));await(queuedEntered)
        val reset=workers.submit{NetworkBridge.reset();NetworkBridge.install{request,_->newStarts.incrementAndGet();response(request)}}
        try{reset.get(500,TimeUnit.MILLISECONDS);assertEquals("BROKER_RESET",queued.get(500,TimeUnit.MILLISECONDS))}finally{release.countDown()}
        active.forEach{assertEquals("BROKER_RESET",it.get(2,TimeUnit.SECONDS))};assertEquals(6,oldStarts.get());assertEquals(0,newStarts.get())
    }

    @Test fun coroutineCancellationCompletesWhileSynchronousTransportIsStillBlocked()=runBlocking {
        val entered=CountDownLatch(1);val exited=CountDownLatch(1)
        NetworkBridge.install{request,_->entered.countDown();try{release.await();response(request)}finally{exited.countDown()}}
        val job=launch(Dispatchers.IO){Requests().get("https://source.example/")}
        await(entered);job.cancel()
        try{withTimeout(500){job.join()};assertEquals(1L,exited.count)}finally{release.countDown()}
        await(exited)
    }

    @Test fun cookieSaveFailureClosesResponseAndReleasesAdmission(){
        val closed=AtomicInteger()
        val jar=object:CookieJar{override fun loadForRequest(url:HttpUrl)=emptyList<Cookie>();override fun saveFromResponse(url:HttpUrl,cookies:List<Cookie>){throw IllegalStateException("cookie failure")}}
        NetworkBridge.install{request,_->response(request,closed)}
        try{client.newBuilder().cookieJar(jar).build().newCall(Request.Builder().url("https://source.example/").build()).execute();fail("Expected cookie failure")}catch(expected:IllegalStateException){assertEquals("cookie failure",expected.message)}
        assertEquals(1,closed.get());assertEquals("ok",execute(call()).get(2,TimeUnit.SECONDS))
    }

    @Test fun suspendedRequestReceivesCheckedBrokerRejection()=runBlocking {
        val rejection=Exception("ORIGIN_NOT_ALLOWED")
        NetworkBridge.install{_,_->throw rejection}
        try{Requests().get("https://source.example/");fail("Broker rejection was accepted")}
        catch(actual:Exception){assertEquals(Exception::class.java,actual.javaClass);assertEquals("ORIGIN_NOT_ALLOWED",actual.message)}
    }

    @Test fun resetDoesNotWaitForCookieLoadingAndPreventsItsStaleTransport(){
        val entered=CountDownLatch(1);val starts=AtomicInteger()
        val jar=object:CookieJar{override fun loadForRequest(url:HttpUrl):List<Cookie>{entered.countDown();release.await();return emptyList()};override fun saveFromResponse(url:HttpUrl,cookies:List<Cookie>){fail("Stale cookie save")}}
        NetworkBridge.install{request,_->starts.incrementAndGet();response(request)}
        val old=failure(client.newBuilder().cookieJar(jar).build().newCall(Request.Builder().url("https://source.example/").build()));await(entered)
        val reset=workers.submit{NetworkBridge.reset()}
        try{reset.get(500,TimeUnit.MILLISECONDS)}finally{release.countDown()}
        assertEquals("BROKER_RESET",old.get(2,TimeUnit.SECONDS));assertEquals(0,starts.get())
    }

    @Test fun cancellingDuringCookieLoadingPreventsTransport(){
        val entered=CountDownLatch(1);val starts=AtomicInteger()
        val jar=object:CookieJar{override fun loadForRequest(url:HttpUrl):List<Cookie>{entered.countDown();release.await();return emptyList()};override fun saveFromResponse(url:HttpUrl,cookies:List<Cookie>){fail("Cancelled cookie save")}}
        NetworkBridge.install{request,_->starts.incrementAndGet();response(request)}
        val active=client.newBuilder().cookieJar(jar).build().newCall(Request.Builder().url("https://source.example/").build())
        val result=failure(active);await(entered);active.cancel();release.countDown()
        assertTrue(result.get(2,TimeUnit.SECONDS).contains("Cancel",true));assertEquals(0,starts.get())
    }

    @Test fun transportFailureReleasesAdmission(){
        val count=AtomicInteger()
        NetworkBridge.install{request,_->if(count.incrementAndGet()<=6)throw IOException("transport failure");response(request)}
        val failed=(0 until 6).map{failure(call())};failed.forEach{assertEquals("transport failure",it.get(2,TimeUnit.SECONDS))}
        assertEquals("ok",execute(call()).get(2,TimeUnit.SECONDS))
    }

    @Test fun cookieJarAndHeadersKeepExistingRequestContract(){
        val saved=CopyOnWriteArrayList<Cookie>()
        val jar=object:CookieJar{
            override fun loadForRequest(url:HttpUrl)=listOf(Cookie.Builder().name("session").value("scoped").domain(url.host).build())
            override fun saveFromResponse(url:HttpUrl,cookies:List<Cookie>){saved.addAll(cookies)}
        }
        NetworkBridge.install{request,follow->assertFalse(follow);assertEquals("scoped",request.header("X-Source"));assertEquals("session=scoped",request.header("Cookie"));response(request).newBuilder().header("Set-Cookie","next=value; Path=/").build()}
        client.newBuilder().cookieJar(jar).followRedirects(false).build().newCall(Request.Builder().url("https://source.example/").header("X-Source","scoped").build()).execute().close()
        assertEquals(listOf("next"),saved.map{it.name})
    }

    @Test fun controlledLatencyBenchmark(){
        val entered=CountDownLatch(1)
        NetworkBridge.install{request,_->if(request.url.host=="slow.example"){entered.countDown();Thread.sleep(300)}else Thread.sleep(20);response(request)}
        val start=System.nanoTime();val slow=execute(call("slow.example"));await(entered)
        val fastStart=System.nanoTime();val fast=execute(call("fast.example"));fast.get(2,TimeUnit.SECONDS)
        val fastMs=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-fastStart);slow.get(2,TimeUnit.SECONDS)
        val totalMs=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start)
        println("NETWORK_BRIDGE_CONTROLLED_BENCHMARK slow_delay_ms=300 fast_delay_ms=20 fast_completion_ms=$fastMs total_ms=$totalMs")
    }
    @Test fun slowCookiePersistenceDoesNotBlockIndependentNetworkAdmission(){
        val entered=CountDownLatch(1)
        val jar=object:CookieJar{
            override fun loadForRequest(url:HttpUrl)=emptyList<Cookie>()
            override fun saveFromResponse(url:HttpUrl,cookies:List<Cookie>){entered.countDown();release.await()}
        }
        NetworkBridge.install{request,_->response(request)}
        val slow=execute(client.newBuilder().cookieJar(jar).build().newCall(Request.Builder().url("https://slow.example/").build()))
        await(entered)
        try{assertEquals("ok",execute(call("fast.example")).get(500,TimeUnit.MILLISECONDS))}
        finally{release.countDown()}
        assertEquals("ok",slow.get(2,TimeUnit.SECONDS))
    }

    @Test fun resetDoesNotWaitForProviderCookiePersistenceAndRejectsItsOldResponse(){
        val entered=CountDownLatch(1);val closed=AtomicInteger()
        val jar=object:CookieJar{
            override fun loadForRequest(url:HttpUrl)=emptyList<Cookie>()
            override fun saveFromResponse(url:HttpUrl,cookies:List<Cookie>){entered.countDown();release.await()}
        }
        NetworkBridge.install{request,_->response(request,closed)}
        val slow=failure(client.newBuilder().cookieJar(jar).build().newCall(Request.Builder().url("https://slow.example/").build()))
        await(entered)
        try{workers.submit{NetworkBridge.reset()}.get(500,TimeUnit.MILLISECONDS)}finally{release.countDown()}
        assertEquals("BROKER_RESET",slow.get(2,TimeUnit.SECONDS));assertEquals(1,closed.get())
    }

}
