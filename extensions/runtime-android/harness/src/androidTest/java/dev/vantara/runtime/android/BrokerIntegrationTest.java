package dev.vantara.runtime.android;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import dev.vantara.runtime.http.*;
import dev.vantara.runtime.api.RuntimeHttpAccess;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import okhttp3.tls.*;
import okio.Buffer;
import org.junit.*;
import javax.net.SocketFactory;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Isolated DEX -> Binder/socket payloads -> production host broker -> actual local TLS. No source site traffic. */
public class BrokerIntegrationTest {
    private Context host;private File dex;private String hash;private Path cookies;
    private MockWebServer server;private AndroidRuntimeClient client;private BrokerHostTransport transport;
    private HttpBroker broker;private OkHttpClient base;
    private final AtomicReference<Exception> hostFailure=new AtomicReference<>();
    private AndroidRuntimeClient.Scope scope(){return new AndroidRuntimeClient.Scope("cloudstream","fixture-package","fixture-source","fixture-account",new HashSet<>(Arrays.asList("https://fixtures.example")));}
    @Before public void prepare() throws Exception {
        host=InstrumentationRegistry.getInstrumentation().getTargetContext();
        dex=File.createTempFile("broker-fixture-",".dex",host.getCacheDir());
        try(InputStream in=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("classes.dex")){Files.copy(in,dex.toPath(),StandardCopyOption.REPLACE_EXISTING);}
        StringBuilder h=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(dex.toPath())))h.append(String.format(Locale.ROOT,"%02x",b&255));hash=h.toString();assertTrue(dex.setReadOnly());
        cookies=Files.createTempDirectory(host.getFilesDir().toPath(),"broker-cookies-");
        HeldCertificate cert=new HeldCertificate.Builder().addSubjectAlternativeName("fixtures.example").build();
        HandshakeCertificates tls=new HandshakeCertificates.Builder().heldCertificate(cert).build();
        HandshakeCertificates trust=new HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate()).build();
        server=new MockWebServer();server.setProtocols(Arrays.asList(Protocol.HTTP_1_1));server.useHttps(tls.sslSocketFactory(),false);server.start();
        base=new OkHttpClient.Builder().socketFactory(new LocalSocketFactory((InetSocketAddress)server.toProxyAddress().address())).sslSocketFactory(trust.sslSocketFactory(),trust.trustManager()).build();
        broker=new HttpBroker(base,hostname->Arrays.asList(InetAddress.getByAddress(new byte[]{127,0,0,1})),address->address.isLoopbackAddress(),new FileCookieVaults(cookies),Clock.systemUTC());
    }
    @After public void cleanup() throws Exception {
        if(client!=null)client.close();if(transport!=null)transport.close();if(server!=null)server.shutdown();
        if(dex!=null)dex.delete();if(cookies!=null)try(java.util.stream.Stream<Path> paths=Files.walk(cookies)){for(Path p:paths.sorted(Comparator.reverseOrder()).collect(java.util.stream.Collectors.toList()))Files.deleteIfExists(p);}
    }
    private void start() throws Exception {
        transport=new BrokerHostTransport(scope(),broker);
        client=new AndroidRuntimeClient(host,scope(),new AndroidRuntimeClient.HostHttpTransport(){
            @Override public RuntimeHttpAccess.Response exchange(AndroidRuntimeClient.Scope owner,RuntimeHttpAccess.Request request)throws Exception{
                try{return transport.exchange(owner,request);}catch(Exception failure){hostFailure.set(failure);throw failure;}
            }
            @Override public void close(){transport.close();}
        });
        client.load(dex,hash,"dev.vantara.runtime.fixtures.HttpProvider").get(12,TimeUnit.SECONDS);
    }
    private String invokeFailure() throws Exception {
        try{client.invoke("catalogue","{}",8000).get(10,TimeUnit.SECONDS);fail("Expected a broker failure");return "";}
        catch(ExecutionException expected){assertTrue(expected.getCause() instanceof RuntimeFailure);return ((RuntimeFailure)expected.getCause()).code;}
    }
    private String hostDiagnosis(){
        Exception failure=hostFailure.get();if(failure==null)return "No host failure captured";
        StringWriter text=new StringWriter();failure.printStackTrace(new PrintWriter(text));return text.toString();
    }
    @Test public void largePayloadReachesActualTlsServerAndReturnsAcrossIsolatedUid() throws Exception {
        byte[] answer=new byte[256*1024];Arrays.fill(answer,(byte)23);
        server.enqueue(new MockResponse().setResponseCode(207).addHeader("X-Result","kept").setBody(new Buffer().write(answer)));start();
        final String result;
        try{result=client.invoke("catalogue","{}",8000).get(10,TimeUnit.SECONDS);}
        catch(ExecutionException failure){throw new AssertionError(hostDiagnosis(),failure);}
        assertEquals("207:262144:23:kept:https://fixtures.example/post",result);
        RecordedRequest request=server.takeRequest(3,TimeUnit.SECONDS);assertNotNull(request);assertEquals("POST",request.getMethod());assertEquals("real",request.getHeader("X-Fixture"));
        byte[] sent=new byte[160*1024];Arrays.fill(sent,(byte)17);assertArrayEquals(sent,request.getBody().readByteArray());
    }
    @Test public void confirmedChallengePreservesItsCodeAndDoesNotAutoRetry() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(403).addHeader("cf-mitigated","challenge"));start();
        String first=invokeFailure();assertEquals(hostDiagnosis(),"VERIFICATION_REQUIRED",first);assertTrue(transport.needsVerification("https://fixtures.example"));assertFalse(client.isClosed());
        assertEquals("VERIFICATION_REQUIRED",invokeFailure());assertEquals(1,server.getRequestCount());
    }
    @Test public void plainForbiddenStaysDistinctFromHumanVerification() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(403));start();
        String result=invokeFailure();assertEquals(hostDiagnosis(),"ACCESS_DENIED",result);assertFalse(transport.needsVerification("https://fixtures.example"));
    }
    @Test public void defaultPublicAddressPolicyBlocksPrivateDestinationBeforeAnyConnection() throws Exception {
        broker=new HttpBroker(base,hostname->Arrays.asList(InetAddress.getByAddress(new byte[]{127,0,0,1})),new PublicAddresses(),new FileCookieVaults(cookies),Clock.systemUTC());start();
        assertEquals("DNS_ADDRESS_DENIED",invokeFailure());assertEquals(0,server.getRequestCount());
    }
    private static final class LocalSocketFactory extends SocketFactory {
        private final InetSocketAddress endpoint;LocalSocketFactory(InetSocketAddress endpoint){this.endpoint=endpoint;}
        // Android's generic loopback is ::1; MockWebServer may bind IPv4.
        // Route to its actual bound address, preserving TLS hostname checking.
        @Override public Socket createSocket(){return new Socket(){@Override public void connect(SocketAddress ignored,int timeout)throws IOException{super.connect(endpoint,timeout);}};}
        private Socket connected()throws IOException{Socket socket=createSocket();socket.connect(endpoint,3000);return socket;}
        @Override public Socket createSocket(String host,int port)throws IOException{return connected();}
        @Override public Socket createSocket(InetAddress host,int port)throws IOException{return connected();}
        @Override public Socket createSocket(String host,int port,InetAddress local,int localPort)throws IOException{return connected();}
        @Override public Socket createSocket(InetAddress host,int port,InetAddress local,int localPort)throws IOException{return connected();}
    }
}
