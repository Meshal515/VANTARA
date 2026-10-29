package dev.vantara.runtime.http;

import org.junit.*;
import static org.junit.Assert.*;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import okhttp3.tls.*;
import java.io.*;
import java.net.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Real TLS/socket tests against explicitly admitted local origins, not fake HTTP success. */
public class HttpBrokerTest {
    MockWebServer first,second;
    HttpBroker broker;
    String one,two;
    java.security.cert.X509Certificate certificate;
    final Map<String,Vault> vaults=new ConcurrentHashMap<>();
    final AtomicReference<Instant> instant=new AtomicReference<>(Instant.now());
    Clock clock=new Clock(){public ZoneId getZone(){return ZoneOffset.UTC;}public Clock withZone(ZoneId z){return this;}public Instant instant(){return instant.get();}};
    static final class Vault implements HttpBroker.CookieVault {
        final List<Cookie> rows=new ArrayList<>();
        public synchronized List<Cookie> load(HttpUrl url){List<Cookie> out=new ArrayList<>();for(Cookie c:rows)if(c.matches(url)&&c.expiresAt()>System.currentTimeMillis())out.add(c);return out;}
        public synchronized void save(HttpUrl url,List<Cookie> incoming){for(Cookie c:incoming){rows.removeIf(old->old.name().equals(c.name())&&old.domain().equals(c.domain())&&old.path().equals(c.path()));rows.add(c);}}
    }
    @Before public void setup() throws Exception {
        HeldCertificate cert=new HeldCertificate.Builder().addSubjectAlternativeName("one.vantara.example").addSubjectAlternativeName("two.vantara.example").build();
        certificate=cert.certificate();
        HandshakeCertificates serverTls=new HandshakeCertificates.Builder().heldCertificate(cert).build();
        HandshakeCertificates clientTls=new HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate()).build();
        first=new MockWebServer();second=new MockWebServer();first.useHttps(serverTls.sslSocketFactory(),false);second.useHttps(serverTls.sslSocketFactory(),false);first.start();second.start();
        one="https://one.vantara.example:"+first.getPort();two="https://two.vantara.example:"+second.getPort();
        OkHttpClient client=new OkHttpClient.Builder().sslSocketFactory(clientTls.sslSocketFactory(),clientTls.trustManager()).build();
        broker=new HttpBroker(client,host->Arrays.asList(InetAddress.getByName("127.0.0.1")),InetAddress::isLoopbackAddress,
            scope->vaults.computeIfAbsent(scope.sessionId()+"/"+scope.sourceId(),key->new Vault()),clock);
    }
    @After public void stop() throws Exception { first.shutdown();second.shutdown(); }
    HttpBroker.Scope scope(String session){return new HttpBroker.Scope("cloudstream","test.package","source",session,new HashSet<>(Arrays.asList(one,two)));}
    HttpBroker.Input input(String url){return new HttpBroker.Input(url,"GET",new Headers.Builder().build(),null,true);}
    String body(HttpBroker.Output r){return new String(r.body(),java.nio.charset.StandardCharsets.UTF_8);}
    String failure(HttpBroker.Session session,HttpBroker.Input input) throws Exception {try{session.execute(input);fail("Expected failure");return "";}catch(HttpBroker.Failure e){return e.code;}}
    @Test public void getAndPostPreserveStatusHeadersAndBody() throws Exception {
        first.enqueue(new MockResponse().setResponseCode(201).addHeader("X-Result","real").setBody("مرحبا"));
        try(HttpBroker.Session session=broker.open(scope("A"))) {
            HttpBroker.Input request=new HttpBroker.Input(one+"/post","POST",new Headers.Builder().add("Referer",one+"/").add("X-Source","test").build(),"payload".getBytes(),true);
            HttpBroker.Output result=session.execute(request);assertEquals(201,result.status());assertEquals("real",result.headers().get("X-Result"));assertEquals("مرحبا",body(result));
            RecordedRequest sent=first.takeRequest(2,TimeUnit.SECONDS);assertEquals("POST",sent.getMethod());assertEquals("payload",sent.getBody().readUtf8());assertEquals("test",sent.getHeader("X-Source"));
        }
    }
    @Test public void completeBodiesLargerThanBinderTextLimitAreNotTruncated() throws Exception {
        char[] chars=new char[128*1024];Arrays.fill(chars,'x');String value=new String(chars);first.enqueue(new MockResponse().setBody(value));
        try(HttpBroker.Session s=broker.open(scope("A"))){assertEquals(value,body(s.execute(input(one+"/large"))));}
    }
    @Test public void providerEncodingHeadersCannotDisableSafeResponseDecompression() throws Exception {
        byte[] compressed;try(ByteArrayOutputStream bytes=new ByteArrayOutputStream()) {
            try(java.util.zip.GZIPOutputStream gzip=new java.util.zip.GZIPOutputStream(bytes)){gzip.write("<html>عمل عربي</html>".getBytes(java.nio.charset.StandardCharsets.UTF_8));}
            compressed=bytes.toByteArray();
        }
        first.enqueue(new MockResponse().addHeader("Content-Encoding","gzip").setBody(new okio.Buffer().write(compressed)));
        HttpBroker.Input request=new HttpBroker.Input(one+"/compressed","GET",new Headers.Builder().add("Accept-Encoding","gzip, deflate, br").build(),null,true);
        try(HttpBroker.Session s=broker.open(scope("A"))){assertEquals("<html>عمل عربي</html>",body(s.execute(request)));}
        assertEquals("gzip",first.takeRequest(2,TimeUnit.SECONDS).getHeader("Accept-Encoding"));
    }
    @Test public void transportHeadersCopiedByOkHttpProvidersAreDroppedNotRefused() throws Exception {
        first.enqueue(new MockResponse().setBody("ok"));
        HttpBroker.Input r=new HttpBroker.Input(one+"/page","GET",new Headers.Builder().add("Host","spoofed.example").add("Connection","close").add("Content-Length","0").add("X-Source","kept").build(),null,true);
        try(HttpBroker.Session s=broker.open(scope("A"))){assertEquals("ok",body(s.execute(r)));}
        RecordedRequest sent=first.takeRequest(2,TimeUnit.SECONDS);assertEquals("kept",sent.getHeader("X-Source"));assertNotEquals("spoofed.example",sent.getHeader("Host"));assertNotEquals("close",sent.getHeader("Connection"));
    }
    @Test public void redirectChainsLongerThanFiveHopsAreFollowedUpToOkHttpsLimit() throws Exception {
        for(int i=0;i<8;i++)first.enqueue(new MockResponse().setResponseCode(302).addHeader("Location","/hop"+(i+1)));
        first.enqueue(new MockResponse().setBody("arrived"));
        try(HttpBroker.Session s=broker.open(scope("A"))){HttpBroker.Output out=s.execute(input(one+"/hop0"));assertEquals("arrived",body(out));assertTrue(out.url().endsWith("/hop8"));}
    }
    @Test public void endlessRedirectLoopsStillStopAtTheLimit() throws Exception {
        for(int i=0;i<=HttpBroker.MAX_REDIRECTS;i++)first.enqueue(new MockResponse().setResponseCode(302).addHeader("Location","/loop"));
        try(HttpBroker.Session s=broker.open(scope("A"))){assertEquals("REDIRECT_LIMIT",failure(s,input(one+"/loop")));}
    }
    @Test public void eachRedirectRequiresOriginPermission() throws Exception {
        first.enqueue(new MockResponse().setResponseCode(302).addHeader("Location",two+"/next"));
        HttpBroker.Scope restricted=new HttpBroker.Scope("cloudstream","test.package","source","A",new HashSet<>(Arrays.asList(one)));
        try(HttpBroker.Session s=broker.open(restricted)){assertEquals("ORIGIN_NOT_ALLOWED",failure(s,input(one+"/start")));assertNull(second.takeRequest(100,TimeUnit.MILLISECONDS));}
    }
    @Test public void crossOriginRedirectDropsCredentialsAndSanitizesReferer() throws Exception {
        first.enqueue(new MockResponse().setResponseCode(302).addHeader("Location",two+"/next"));second.enqueue(new MockResponse().setBody("done"));
        try(HttpBroker.Session s=broker.open(scope("A"))) {
            HttpBroker.Input r=new HttpBroker.Input(one+"/private?secret=value","GET",new Headers.Builder().add("Authorization","secret").add("Cookie","manual=secret").add("Referer",one+"/private?secret=value").build(),null,true);
            assertEquals("done",body(s.execute(r)));RecordedRequest next=second.takeRequest(2,TimeUnit.SECONDS);assertNull(next.getHeader("Authorization"));assertNull(next.getHeader("Cookie"));assertEquals(one+"/",next.getHeader("Referer"));
        }
    }
    @Test public void sessionCookiesSurviveWorkerLeaseRestartButNeverCrossAccounts() throws Exception {
        first.enqueue(new MockResponse().addHeader("Set-Cookie","session=alpha; Path=/; Secure; HttpOnly").setBody("set"));
        try(HttpBroker.Session a=broker.open(scope("A"))){a.execute(input(one+"/login"));}first.takeRequest(2,TimeUnit.SECONDS);
        first.enqueue(new MockResponse().setBody("again"));try(HttpBroker.Session a=broker.open(scope("A"))){a.execute(input(one+"/again"));}assertEquals("session=alpha",first.takeRequest(2,TimeUnit.SECONDS).getHeader("Cookie"));
        first.enqueue(new MockResponse().setBody("other"));try(HttpBroker.Session b=broker.open(scope("B"))){b.execute(input(one+"/other"));}assertNull(first.takeRequest(2,TimeUnit.SECONDS).getHeader("Cookie"));
    }
    @Test public void rateLimitIsSharedByHostAcrossSourcesAndDoesNotRetry() throws Exception {
        first.enqueue(new MockResponse().setResponseCode(429).addHeader("Retry-After","2").setBody("slow"));
        try(HttpBroker.Session a=broker.open(scope("A"));HttpBroker.Session b=broker.open(scope("B"))) {
            assertEquals("RATE_LIMITED",failure(a,input(one+"/rate")));assertEquals("HOST_COOLDOWN",failure(b,input(one+"/blocked")));assertEquals(1,first.getRequestCount());
            instant.set(instant.get().plusSeconds(3));first.enqueue(new MockResponse().setBody("ok"));assertEquals("ok",body(b.execute(input(one+"/resumed"))));
        }
    }
    @Test public void humanChallengeIsSilentAndScopedButBare403IsNotCloudflare() throws Exception {
        first.enqueue(new MockResponse().setResponseCode(403).addHeader("cf-mitigated","challenge"));
        try(HttpBroker.Session a=broker.open(scope("A"));HttpBroker.Session b=broker.open(scope("B"))) {
            assertEquals("VERIFICATION_REQUIRED",failure(a,input(one+"/challenge")));assertTrue(a.needsVerification(one));assertFalse(b.needsVerification(one));
            assertEquals("VERIFICATION_REQUIRED",failure(a,input(one+"/no-repeat")));assertEquals(1,first.getRequestCount());
            // A bare 403 reaches the provider as a response so it can try its next server; it is not a challenge.
            first.enqueue(new MockResponse().setResponseCode(403).setBody("denied"));HttpBroker.Output denied=b.execute(input(one+"/denied"));
            assertEquals(403,denied.status());assertEquals("denied",body(denied));assertFalse(b.needsVerification(one));
            first.enqueue(new MockResponse().setBody("next"));assertEquals("next",body(b.execute(input(one+"/next-server"))));
        }
    }
    @Test public void redirectsCanBeReturnedWithoutFollowingAnd307PreservesPost() throws Exception {
        first.enqueue(new MockResponse().setResponseCode(302).addHeader("Location",two+"/unused"));
        try(HttpBroker.Session s=broker.open(scope("A"))) {
            assertEquals(302,s.execute(new HttpBroker.Input(one+"/nofollow","GET",new Headers.Builder().build(),null,false)).status());assertEquals(0,second.getRequestCount());
            first.enqueue(new MockResponse().setResponseCode(307).addHeader("Location",two+"/post"));second.enqueue(new MockResponse().setBody("ok"));
            s.execute(new HttpBroker.Input(one+"/post","POST",new Headers.Builder().build(),"body".getBytes(),true));RecordedRequest r=second.takeRequest(2,TimeUnit.SECONDS);assertEquals("POST",r.getMethod());assertEquals("body",r.getBody().readUtf8());
        }
    }
    @Test public void closedLeaseCannotIssueRequests() throws Exception {HttpBroker.Session s=broker.open(scope("A"));s.close();assertEquals("SESSION_CLOSED",failure(s,input(one+"/closed")));assertEquals(0,first.getRequestCount());}
    @Test public void unapprovedPrivateDnsCannotOpenSocket() throws Exception {
        broker=new HttpBroker(new OkHttpClient(),h->Arrays.asList(InetAddress.getByName("127.0.0.1")),a->false,scope->new Vault(),clock);
        try(HttpBroker.Session s=broker.open(scope("A"))){assertEquals("DNS_ADDRESS_DENIED",failure(s,input(one+"/private")));assertEquals(0,first.getRequestCount());}
    }
    @Test public void cancellationKeepsHostLeaseUntilPhysicalDnsReturns() throws Exception {
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        AtomicInteger calls=new AtomicInteger();
        broker=new HttpBroker(new OkHttpClient.Builder().sslSocketFactory(new HandshakeCertificates.Builder().addTrustedCertificate(certificate).build().sslSocketFactory(),new HandshakeCertificates.Builder().addTrustedCertificate(certificate).build().trustManager()).build(),h->{
            if(calls.getAndIncrement()==0){entered.countDown();try{release.await();}catch(InterruptedException e){Thread.currentThread().interrupt();throw new UnknownHostException("interrupted");}}
            return Arrays.asList(InetAddress.getByName("127.0.0.1"));
        },InetAddress::isLoopbackAddress,scope->new Vault(),clock,1);
        ExecutorService pool=Executors.newSingleThreadExecutor();
        try(HttpBroker.Session a=broker.open(scope("A"));HttpBroker.Session b=broker.open(scope("B"))) {
            Future<String> running=pool.submit(()->failure(a,input(one+"/blocked-dns")));
            assertTrue(entered.await(2,TimeUnit.SECONDS));a.close();
            assertEquals("HOST_BUSY",failure(b,input(one+"/still-physical")));
            release.countDown();assertEquals("SESSION_CLOSED",running.get(3,TimeUnit.SECONDS));
            first.enqueue(new MockResponse().setBody("released"));assertEquals("released",body(b.execute(input(one+"/after-release"))));
        } finally {release.countDown();pool.shutdownNow();}
    }
    @Test public void serverErrorsAreResponsesAndDoNotCoolTheHost() throws Exception {
        first.enqueue(new MockResponse().setResponseCode(503).setBody("down"));first.enqueue(new MockResponse().setBody("up"));
        try(HttpBroker.Session s=broker.open(scope("A"))){assertEquals(503,s.execute(input(one+"/a")).status());assertEquals("up",body(s.execute(input(one+"/b"))));}
    }
    @Test public void publicInternetScopeReachesAnyPublicHostButStillRefusesPrivateAddresses() throws Exception {
        HttpBroker.Scope open=new HttpBroker.Scope("cloudstream","pkg","s","A",new HashSet<>(Arrays.asList(HttpBroker.PUBLIC_INTERNET)));
        first.enqueue(new MockResponse().setBody("cdn"));second.enqueue(new MockResponse().setBody("video-host"));
        try(HttpBroker.Session s=broker.open(open)){assertEquals("cdn",body(s.execute(input(one+"/x"))));assertEquals("video-host",body(s.execute(input(two+"/y"))));}
        // Loopback stood in for "public" above; a resolver answer the permission rejects is still refused.
        broker=new HttpBroker(new OkHttpClient(),h->Arrays.asList(InetAddress.getByName("127.0.0.1")),a->false,scope->new Vault(),clock);
        try(HttpBroker.Session s=broker.open(open)){assertEquals("DNS_ADDRESS_DENIED",failure(s,input(one+"/private")));}
    }
    @Test public void oneHostServesParallelRequestsOfOneEpisode() throws Exception {
        first.setDispatcher(new okhttp3.mockwebserver.Dispatcher(){public MockResponse dispatch(RecordedRequest r){try{Thread.sleep(300);}catch(InterruptedException e){Thread.currentThread().interrupt();}return new MockResponse().setBody("server");}});
        ExecutorService pool=Executors.newFixedThreadPool(4);
        try(HttpBroker.Session s=broker.open(scope("A"))) {
            List<Future<String>> all=new ArrayList<>();for(int i=0;i<4;i++){final int n=i;all.add(pool.submit(()->body(s.execute(input(one+"/server"+n)))));}
            for(Future<String> f:all)assertEquals("server",f.get(5,TimeUnit.SECONDS));
        } finally {pool.shutdownNow();}
    }
    @Test public void bodyLimitRejectsOversizeWithoutTruncatingSuccess() throws Exception {
        first.enqueue(new MockResponse().setBody("x").setHeader("Content-Length",HttpBroker.MAX_RESPONSE_BYTES+1));
        try(HttpBroker.Session s=broker.open(scope("A"))) {
            assertEquals("RESPONSE_BODY_LIMIT",failure(s,input(one+"/oversize")));
            first.enqueue(new MockResponse().setBody("still healthy"));assertEquals("still healthy",body(s.execute(input(one+"/healthy"))));
        }
    }
    @Test public void mutableCallerDataCannotExpandPermissionsOrChangeBody() throws Exception {
        Set<String> origins=new HashSet<>(Arrays.asList(one));HttpBroker.Scope frozen=new HttpBroker.Scope("cloudstream","pkg","s","A",origins);origins.add(two);
        byte[] bytes="original".getBytes();HttpBroker.Input r=new HttpBroker.Input(one+"/copy","POST",new Headers.Builder().build(),bytes,true);bytes[0]='X';r.body()[0]='Y';
        first.enqueue(new MockResponse().setBody("ok"));try(HttpBroker.Session s=broker.open(frozen)){
            s.execute(r);assertEquals("original",first.takeRequest(2,TimeUnit.SECONDS).getBody().readUtf8());assertEquals("ORIGIN_NOT_ALLOWED",failure(s,input(two+"/injected")));
        }
    }
    @Test public void distinctSourcesDoNotShareCookiesEvenWithinOneAccount() throws Exception {
        first.enqueue(new MockResponse().setHeader("Set-Cookie","secret=sourceA; Path=/; Secure").setBody("ok"));
        try(HttpBroker.Session a=broker.open(scope("A"))){a.execute(input(one+"/a"));}first.takeRequest();
        HttpBroker.Scope other=new HttpBroker.Scope("cloudstream","pkg","another-source","A",new HashSet<>(Arrays.asList(one)));
        first.enqueue(new MockResponse().setBody("ok"));try(HttpBroker.Session b=broker.open(other)){b.execute(input(one+"/b"));}
        assertNull(first.takeRequest(2,TimeUnit.SECONDS).getHeader("Cookie"));
    }

    @Test public void legacyInteractiveInterceptorsAreNotInherited() throws Exception {
        HandshakeCertificates tls=new HandshakeCertificates.Builder().addTrustedCertificate(certificate).build();
        OkHttpClient legacy=new OkHttpClient.Builder().sslSocketFactory(tls.sslSocketFactory(),tls.trustManager()).addInterceptor(chain->{throw new AssertionError("Legacy UI interceptor executed");}).build();
        broker=new HttpBroker(legacy,h->Arrays.asList(InetAddress.getByName("127.0.0.1")),InetAddress::isLoopbackAddress,s->new Vault(),clock);
        first.enqueue(new MockResponse().setBody("quiet"));try(HttpBroker.Session s=broker.open(scope("A"))){assertEquals("quiet",body(s.execute(input(one+"/quiet"))));}
    }
    @Test public void inheritedGlobalCacheCannotLeakAccountResponse() throws Exception {
        java.nio.file.Path directory=java.nio.file.Files.createTempDirectory("runtime-cache-leak-test");
        HandshakeCertificates tls=new HandshakeCertificates.Builder().addTrustedCertificate(certificate).build();
        try(Cache cache=new Cache(directory.toFile(),5L*1024*1024)) {
            OkHttpClient legacy=new OkHttpClient.Builder().sslSocketFactory(tls.sslSocketFactory(),tls.trustManager()).cache(cache).build();
            broker=new HttpBroker(legacy,h->Arrays.asList(InetAddress.getByName("127.0.0.1")),InetAddress::isLoopbackAddress,s->new Vault(),clock);
            first.enqueue(new MockResponse().addHeader("Cache-Control","public, max-age=600").setBody("private-A"));
            first.enqueue(new MockResponse().setBody("private-B"));
            try(HttpBroker.Session a=broker.open(scope("A"));HttpBroker.Session b=broker.open(scope("B"))) {
                assertEquals("private-A",body(a.execute(input(one+"/same-url"))));
                assertEquals("private-B",body(b.execute(input(one+"/same-url"))));assertEquals(2,first.getRequestCount());
            }
        } finally {try(java.util.stream.Stream<java.nio.file.Path> paths=java.nio.file.Files.walk(directory)){paths.sorted(Comparator.reverseOrder()).forEach(path->{try{java.nio.file.Files.deleteIfExists(path);}catch(IOException e){throw new java.io.UncheckedIOException(e);}});}}
    }

}
