package dev.vantara.runtime.android;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import dev.vantara.runtime.api.RuntimeHttpAccess;
import org.junit.*;
import java.io.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Real Binder transactions across the isolated UID; transport is explicitly an authored fixture. */
public class HttpExchangeTest {
    Context context;File dex;String hash;AndroidRuntimeClient client;
    @Before public void prepare() throws Exception {
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();dex=File.createTempFile("http-fixture-",".dex",context.getCacheDir());
        try(InputStream in=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("classes.dex")){Files.copy(in,dex.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);}
        StringBuilder hex=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(dex.toPath())))hex.append(String.format(Locale.ROOT,"%02x",b&255));hash=hex.toString();assertTrue(dex.setReadOnly());
    }
    @After public void finish() throws Exception {if(client!=null)client.close();Files.deleteIfExists(dex.toPath());}
    AndroidRuntimeClient.Scope scope(){return new AndroidRuntimeClient.Scope("vantara-test","http-fixture","source","account",new HashSet<>(Arrays.asList("https://fixtures.example")));}
    @Test public void fullHttpExchangePreservesLargeRequestAndResponseBytesAndActualStatus() throws Exception {
        AtomicReference<AndroidRuntimeClient.Scope> seen=new AtomicReference<>();
        client=new AndroidRuntimeClient(context,scope(),new AndroidRuntimeClient.HostHttpTransport(){
            public RuntimeHttpAccess.Response exchange(AndroidRuntimeClient.Scope owner,RuntimeHttpAccess.Request request){
                seen.set(owner);assertEquals("POST",request.method());assertFalse(request.followRedirects());assertEquals(160*1024,request.body().length);assertEquals(17,request.body()[request.body().length-1]);assertEquals("real",request.headers().get("X-Fixture").get(0));
                byte[] body=new byte[256*1024];Arrays.fill(body,(byte)23);
                return new RuntimeHttpAccess.Response("https://fixtures.example/final",207,Collections.singletonMap("X-Result",Arrays.asList("kept")),body);
            }
        });
        client.load(dex,hash,"dev.vantara.runtime.fixtures.HttpProvider").get(12,TimeUnit.SECONDS);
        assertEquals("207:262144:23:kept:https://fixtures.example/final",client.invoke("catalogue","{}",4000).get(6,TimeUnit.SECONDS));assertEquals("account",seen.get().sessionId());
    }
    @Test public void unsupportedTransportNeverFabricatesSuccessfulHttpStatus() throws Exception {
        client=new AndroidRuntimeClient(context,scope(),(s,u)->"legacy-text");client.load(dex,hash,"dev.vantara.runtime.fixtures.HttpProvider").get(12,TimeUnit.SECONDS);
        try{client.invoke("catalogue","{}",4000).get(6,TimeUnit.SECONDS);fail("Fake HTTP success");}
        catch(ExecutionException expected){assertEquals("FULL_HTTP_UNSUPPORTED",expected.getCause().getMessage());}
    }
    @Test public void workerRetirementRevokesHostTransport() throws Exception {
        CountDownLatch closed=new CountDownLatch(1);
        client=new AndroidRuntimeClient(context,scope(),new AndroidRuntimeClient.HostHttpTransport(){
            public RuntimeHttpAccess.Response exchange(AndroidRuntimeClient.Scope s,RuntimeHttpAccess.Request r){throw new AssertionError();}
            public void close(){closed.countDown();}
        });
        client.load(dex,hash,"dev.vantara.runtime.fixtures.HttpProvider").get(12,TimeUnit.SECONDS);client.close();assertTrue(closed.await(3,TimeUnit.SECONDS));
    }
}
