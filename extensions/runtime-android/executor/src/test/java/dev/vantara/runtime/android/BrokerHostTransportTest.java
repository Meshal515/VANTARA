package dev.vantara.runtime.android;

import dev.vantara.runtime.api.RuntimeHttpAccess;
import dev.vantara.runtime.http.*;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import okhttp3.tls.*;
import okio.Buffer;
import org.junit.*;
import org.junit.rules.TemporaryFolder;
import javax.net.SocketFactory;
import java.io.*;
import java.net.*;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;

/** Real TLS, broker and disk cookies; only the test socket destination is locally routed. */
public class BrokerHostTransportTest {
    private static final String ORIGIN="https://fixtures.example";
    @Rule public TemporaryFolder temporary=new TemporaryFolder();
    private MockWebServer server;
    private HttpBroker broker;
    @Before public void prepare() throws Exception {
        HeldCertificate certificate=new HeldCertificate.Builder().addSubjectAlternativeName("fixtures.example").build();
        HandshakeCertificates serverTls=new HandshakeCertificates.Builder().heldCertificate(certificate).build();
        HandshakeCertificates clientTls=new HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate()).build();
        server=new MockWebServer();server.useHttps(serverTls.sslSocketFactory(),false);server.start();
        OkHttpClient base=new OkHttpClient.Builder().socketFactory(new LocalSocketFactory((InetSocketAddress)server.toProxyAddress().address()))
            .sslSocketFactory(clientTls.sslSocketFactory(),clientTls.trustManager()).build();
        broker=new HttpBroker(base,host->Arrays.asList(InetAddress.getByAddress(new byte[]{127,0,0,1})),
            address->address.isLoopbackAddress(),new FileCookieVaults(temporary.getRoot().toPath()),Clock.systemUTC());
    }
    @After public void cleanup() throws Exception {server.shutdown();}
    private AndroidRuntimeClient.Scope scope(String account){return new AndroidRuntimeClient.Scope("cloudstream","package-stable-id","source-stable-id",account,new HashSet<>(Arrays.asList(ORIGIN)));}
    private RuntimeHttpAccess.Request get(){return new RuntimeHttpAccess.Request(ORIGIN+"/catalogue","GET",Collections.emptyMap(),null,true);}
    private String failure(BrokerHostTransport transport,AndroidRuntimeClient.Scope caller,RuntimeHttpAccess.Request request) throws Exception {
        try{transport.exchange(caller,request);fail("Expected an explicit broker failure");return "";}
        catch(RuntimeFailure expected){return expected.code;}
    }
    @Test public void actualPostRetainsBytesHeadersStatusAndUrl() throws Exception {
        byte[] sent=new byte[160*1024],answer=new byte[256*1024];Arrays.fill(sent,(byte)17);Arrays.fill(answer,(byte)23);
        server.enqueue(new MockResponse().setResponseCode(207).addHeader("X-Result","first").addHeader("X-Result","second").setBody(new Buffer().write(answer)));
        AndroidRuntimeClient.Scope owner=scope("account");
        try(BrokerHostTransport transport=new BrokerHostTransport(owner,broker)){
            RuntimeHttpAccess.Response response=transport.exchange(owner,new RuntimeHttpAccess.Request(ORIGIN+"/post?query=value","POST",Collections.singletonMap("X-Source",Arrays.asList("actual")),sent,false));
            assertEquals(207,response.status());assertEquals(ORIGIN+"/post?query=value",response.url());assertArrayEquals(answer,response.body());
            List<String> values=null;for(Map.Entry<String,List<String>> row:response.headers().entrySet())if(row.getKey().equalsIgnoreCase("X-Result"))values=row.getValue();
            assertEquals(Arrays.asList("first","second"),values);
            RecordedRequest request=server.takeRequest(3,TimeUnit.SECONDS);assertNotNull(request);
            assertEquals("POST",request.getMethod());assertEquals("/post?query=value",request.getPath());assertEquals("actual",request.getHeader("X-Source"));assertArrayEquals(sent,request.getBody().readByteArray());
        }
    }
    @Test public void differentAccountCannotBorrowTheBoundSession() throws Exception {
        try(BrokerHostTransport transport=new BrokerHostTransport(scope("first"),broker)){
            assertEquals("SCOPE_MISMATCH",failure(transport,scope("second"),get()));assertEquals(0,server.getRequestCount());
        }
    }
    @Test public void actualTlsResponseKeepsHttpCaseInsensitiveLookup() throws Exception {
        server.enqueue(new MockResponse().addHeader("X-Result","kept").setBody("body"));
        AndroidRuntimeClient.Scope owner=scope("account");
        try(BrokerHostTransport transport=new BrokerHostTransport(owner,broker)){
            assertEquals(Arrays.asList("kept"),transport.exchange(owner,get()).headers().get("X-Result"));
        }
    }
    @Test public void confirmedChallengeStaysSilentAndRequiresHostAcknowledgement() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(403).addHeader("cf-mitigated","challenge"));
        AndroidRuntimeClient.Scope owner=scope("account");
        try(BrokerHostTransport transport=new BrokerHostTransport(owner,broker)){
            assertEquals("VERIFICATION_REQUIRED",failure(transport,owner,get()));assertTrue(transport.needsVerification(ORIGIN));
            assertEquals("VERIFICATION_REQUIRED",failure(transport,owner,get()));assertEquals(1,server.getRequestCount());
            HttpBroker.Scope identity=new HttpBroker.Scope(owner.family(),owner.packageId(),owner.sourceId(),owner.sessionId(),owner.allowedOrigins());
            broker.verificationSucceeded(identity,ORIGIN);server.enqueue(new MockResponse().setBody("ready"));
            assertEquals(200,transport.exchange(owner,get()).status());assertFalse(transport.needsVerification(ORIGIN));
        }
    }
    /** A bare 403 reaches the provider as a response it can read, and is not a Cloudflare challenge. */
    @Test public void bareForbiddenIsNotCloudflareVerification() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(403));AndroidRuntimeClient.Scope owner=scope("account");
        try(BrokerHostTransport transport=new BrokerHostTransport(owner,broker)){
            assertEquals(403,transport.exchange(owner,get()).status());assertFalse(transport.needsVerification(ORIGIN));
        }
    }
    @Test public void cookiesSurviveTransportRestartAndStayAccountScoped() throws Exception {
        server.enqueue(new MockResponse().addHeader("Set-Cookie","session=keep; Path=/; Secure; HttpOnly").setBody("login"));
        try(BrokerHostTransport transport=new BrokerHostTransport(scope("first"),broker)){transport.exchange(scope("first"),get());}
        assertNotNull(server.takeRequest(3,TimeUnit.SECONDS));
        server.enqueue(new MockResponse().setBody("same"));
        try(BrokerHostTransport transport=new BrokerHostTransport(scope("first"),broker)){transport.exchange(scope("first"),get());}
        assertEquals("session=keep",server.takeRequest(3,TimeUnit.SECONDS).getHeader("Cookie"));
        server.enqueue(new MockResponse().setBody("other"));
        try(BrokerHostTransport transport=new BrokerHostTransport(scope("second"),broker)){transport.exchange(scope("second"),get());}
        assertNull(server.takeRequest(3,TimeUnit.SECONDS).getHeader("Cookie"));
    }
    @Test public void closeCancelsAnActualPendingSocket() throws Exception {
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));
        AndroidRuntimeClient.Scope owner=scope("account");BrokerHostTransport transport=new BrokerHostTransport(owner,broker);
        ExecutorService calls=Executors.newSingleThreadExecutor();
        try {
            Future<String> active=calls.submit(()->failure(transport,owner,get()));
            assertNotNull(server.takeRequest(3,TimeUnit.SECONDS));transport.close();
            assertEquals("SESSION_CLOSED",active.get(3,TimeUnit.SECONDS));
            assertEquals("SESSION_CLOSED",failure(transport,owner,get()));
        }finally{transport.close();calls.shutdownNow();}
    }
    @Test public void transportFailureKeepsHostCauseWithoutPuttingItInThePublicCode() throws Exception {
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START));
        AndroidRuntimeClient.Scope owner=scope("account");
        try(BrokerHostTransport transport=new BrokerHostTransport(owner,broker)){
            try{transport.exchange(owner,get());fail("Expected failed TLS transport");}
            catch(RuntimeFailure failure){
                assertEquals("TRANSPORT_FAILED",failure.code);assertEquals("TRANSPORT_FAILED",failure.getMessage());
                assertNotNull("Keep the host broker failure",failure.getCause());
                assertNotNull("Keep the actual host socket/TLS failure",failure.getCause().getCause());
            }
        }
    }
    /** Test-only routing retains the real HTTPS hostname/certificate and actual sockets. */
    private static final class LocalSocketFactory extends SocketFactory {
        private final InetSocketAddress endpoint;LocalSocketFactory(InetSocketAddress endpoint){this.endpoint=endpoint;}
        @Override public Socket createSocket(){return new Socket(){@Override public void connect(SocketAddress ignored,int timeout)throws IOException{super.connect(endpoint,timeout);}};}
        private Socket connected()throws IOException{Socket socket=createSocket();socket.connect(endpoint,3000);return socket;}
        @Override public Socket createSocket(String host,int port)throws IOException{return connected();}
        @Override public Socket createSocket(InetAddress host,int port)throws IOException{return connected();}
        @Override public Socket createSocket(String host,int port,InetAddress local,int localPort)throws IOException{return connected();}
        @Override public Socket createSocket(InetAddress host,int port,InetAddress local,int localPort)throws IOException{return connected();}
    }
}
