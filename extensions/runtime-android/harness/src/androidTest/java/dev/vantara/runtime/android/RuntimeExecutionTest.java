package dev.vantara.runtime.android;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Process;
import android.system.Os;
import android.system.ErrnoException;
import android.system.OsConstants;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

/** Real Android process/DEX tests. Fixtures do not prove third-party family ABI compatibility. */
@RunWith(AndroidJUnit4.class)
public class RuntimeExecutionTest {
    private Context context;
    private File dex, sentinel;
    private String digest;
    private AndroidRuntimeClient client;
    private final String entry = "dev.vantara.runtime.fixtures.FixtureProvider";
    private AndroidRuntimeClient.Scope scope(String source, String session) {
        return new AndroidRuntimeClient.Scope("vantara-test", "fixture.package", source, session,
            new HashSet<>(Arrays.asList("https://fixtures.example")));
    }
    @Before public void prepare() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        dex = File.createTempFile("external-fixture-", ".dex", context.getCacheDir());
        try (InputStream in = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("classes.dex"); OutputStream out = new FileOutputStream(dex)) { byte[] buffer=new byte[8192]; int n; while((n=in.read(buffer))!=-1) out.write(buffer,0,n); }
        byte[] bytes = Files.readAllBytes(dex.toPath());
        StringBuilder hex = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) hex.append(String.format(Locale.ROOT,"%02x", b & 255));
        digest = hex.toString();
        assertTrue(dex.setReadOnly());
        sentinel = new File(context.getFilesDir(), "runtime-test-host-sentinel");
        Files.write(sentinel.toPath(), "preserve-host-data".getBytes(StandardCharsets.UTF_8));
    }
    @After public void finish() throws Exception {
        if (client != null) client.close();
        assertEquals("preserve-host-data", new String(Files.readAllBytes(sentinel.toPath()), StandardCharsets.UTF_8));
        Files.deleteIfExists(dex.toPath());
        Files.deleteIfExists(sentinel.toPath());
    }
    private AndroidRuntimeClient open() throws Exception {
        client = new AndroidRuntimeClient(context, scope("source-A", "session-A"), (s,u) -> "{\"broker\":true}");
        client.connect().get(12, TimeUnit.SECONDS);
        return client;
    }
    private void load() throws Exception { client.load(dex,digest,entry).get(12,TimeUnit.SECONDS); }
    private String call(String op, String json) throws Exception { return client.invoke(op,json,4000).get(6,TimeUnit.SECONDS); }
    private String failure(CompletableFuture<?> future) throws Exception {
        try { future.get(12,TimeUnit.SECONDS); fail("Expected a typed runtime failure"); return ""; }
        catch (ExecutionException e) { assertNotNull(e.getCause().getMessage()); return e.getCause().getMessage(); }
    }
    private void assertProcessGone(int pid) throws Exception {
        long end = android.os.SystemClock.elapsedRealtime()+5000;
        do {
            try { Os.kill(pid,0); }
            catch (ErrnoException e) { if (e.errno==OsConstants.ESRCH) return; }
            Thread.sleep(25);
        } while (android.os.SystemClock.elapsedRealtime()<end);
        fail("Physical worker process remains alive: "+pid);
    }
    @Test public void executesActualExternalDexForAllContentOperations() throws Exception {
        open(); load();
        for (String op : Arrays.asList("catalogue","search","details","episodes","chapters","pages","videoLinks")) {
            JSONObject result = new JSONObject(call(op,"{}"));
            if (op.equals("details")) assertEquals("fixture", result.getJSONObject("item").getString("id"));
            else assertEquals(1,result.getJSONArray("items").length());
        }
    }
    @Test public void isolatedUidCannotReadHostFilesOrCreateInternetSocket() throws Exception {
        open(); AndroidRuntimeClient.Identity id = client.connect().get(2,TimeUnit.SECONDS); load();
        assertNotEquals(Process.myUid(), id.uid()); assertNotEquals(Process.myPid(),id.pid());
        assertEquals(PackageManager.PERMISSION_DENIED, context.checkPermission("android.permission.INTERNET",id.pid(),id.uid()));
        JSONObject result = new JSONObject(call("details",new JSONObject().put("fixtureAction","probe").put("hostFile",sentinel.getAbsolutePath()).toString()));
        assertEquals(id.uid(),result.getInt("uid")); assertEquals(id.pid(),result.getInt("pid"));
        assertTrue(result.getBoolean("hostFileDenied")); assertTrue(result.getBoolean("socketDenied"));
    }
    @Test public void brokerKeepsHostIdentityAndRejectsWrongOrigin() throws Exception {
        AtomicReference<AndroidRuntimeClient.Scope> seen = new AtomicReference<>();
        client = new AndroidRuntimeClient(context,scope("source-A","session-A"),(s,u) -> {seen.set(s);return "{\"broker\":true}";});
        client.connect().get(12,TimeUnit.SECONDS); load();
        String input = new JSONObject().put("fixtureAction","broker").put("url","https://fixtures.example/catalogue").put("sessionId","forged").put("sourceId","forged").toString();
        assertTrue(new JSONObject(call("catalogue",input)).getBoolean("broker"));
        assertEquals("source-A",seen.get().sourceId()); assertEquals("session-A",seen.get().sessionId());
        assertEquals("ORIGIN_NOT_ALLOWED",failure(client.invoke("catalogue",new JSONObject().put("fixtureAction","broker").put("url","https://other.example/").toString(),4000)));
        assertFalse(client.isClosed()); assertEquals(1,new JSONObject(call("catalogue","{}")).getJSONArray("items").length());
    }
    @Test public void rejectsHashMismatchBeforeProviderExecution() throws Exception {
        open(); assertEquals("HASH_MISMATCH",failure(client.load(dex,String.join("",Collections.nCopies(64,"0")),entry)));
        assertTrue(client.isClosed());
        assertEquals("WORKER_CLOSED",failure(client.invoke("catalogue","{}",4000)));
    }
    @Test public void failedInitializationNeverPublishesProvider() throws Exception {
        open(); assertEquals("PROVIDER_INITIALIZATION_FAILED",failure(client.load(dex,digest,"dev.vantara.runtime.fixtures.FailingProvider")));
        assertTrue(client.isClosed());
        assertEquals("WORKER_CLOSED",failure(client.invoke("catalogue","{}",4000)));
    }
    @Test public void missingEntryIsExplicitAbiFailure() throws Exception {
        open(); assertEquals("ABI_MISMATCH",failure(client.load(dex,digest,"dev.vantara.runtime.fixtures.MissingProvider"))); assertTrue(client.isClosed());
    }
    @Test public void providerExceptionDoesNotKillHostOrHealthyGeneration() throws Exception {
        open(); load(); assertEquals("PROVIDER_FAILED",failure(client.invoke("search","{\"fixtureAction\":\"throw\"}",4000)));
        assertFalse(client.isClosed()); assertEquals(1,new JSONObject(call("search","{}")).getJSONArray("items").length());
    }
    @Test public void physicalProcessExitAndRestartPreserveHostData() throws Exception {
        open(); load(); int oldPid=client.connect().get().pid();
        assertEquals("PROCESS_DIED",failure(client.invoke("catalogue","{\"fixtureAction\":\"exit\"}",4000)));
        assertTrue(client.isClosed()); assertProcessGone(oldPid); client.close();
        open(); load(); assertNotEquals(oldPid,client.connect().get().pid());
        assertEquals(1,new JSONObject(call("catalogue","{}")).getJSONArray("items").length());
    }
    @Test public void noncooperativeTimeoutRetiresPhysicalWorker() throws Exception {
        CountDownLatch entered=new CountDownLatch(1);
        client=new AndroidRuntimeClient(context,scope("source-A","session-A"),(s,u)->{entered.countDown();return "{}";});
        client.connect().get(12,TimeUnit.SECONDS); load(); int oldPid=client.connect().get().pid();
        CompletableFuture<String> pending=client.invoke("search","{\"fixtureAction\":\"hang\"}",300);
        assertTrue("Operation must really start before timeout",entered.await(2,TimeUnit.SECONDS));
        assertEquals("OPERATION_TIMEOUT",failure(pending));
        assertTrue(client.isClosed()); assertProcessGone(oldPid);
        assertEquals("WORKER_CLOSED",failure(client.invoke("search","{}",4000)));
    }
    @Test public void unrelatedWorkersHaveIndependentLifetimes() throws Exception {
        open(); load();
        try (AndroidRuntimeClient other = new AndroidRuntimeClient(context,scope("source-B","session-B"),(s,u)->"{}")) {
            AndroidRuntimeClient.Identity second = other.connect().get(12,TimeUnit.SECONDS);
            other.load(dex,digest,entry).get(12,TimeUnit.SECONDS);
            assertNotEquals(client.connect().get().pid(),second.pid());
            assertEquals("PROCESS_DIED",failure(other.invoke("catalogue","{\"fixtureAction\":\"exit\"}",4000)));
            assertEquals(1,new JSONObject(call("catalogue","{}")).getJSONArray("items").length());
        }
    }
    @Test public void rejectsProtectedOperationsAndOversizeInput() throws Exception {
        open(); load();
        for(String op : Arrays.asList("torrent","subtitles","translation","play","deleteAccount"))
            assertEquals("CAPABILITY_UNSUPPORTED",failure(client.invoke(op,"{}",4000)));
        char[] huge = new char[65537]; Arrays.fill(huge,'x');
        assertEquals("PAYLOAD_LIMIT",failure(client.invoke("search",new String(huge),4000)));
    }
    @Test public void repeatedPhysicalGenerationsKeepHostSentinel() throws Exception {
        int previous=-1;
        for(int i=0;i<12;i++) {
            open(); load(); int pid=client.connect().get().pid(); assertNotEquals(previous,pid);
            assertEquals(1,new JSONObject(call("catalogue","{}")).getJSONArray("items").length());
            client.close(); assertProcessGone(pid); previous=pid;
            assertEquals("preserve-host-data",new String(Files.readAllBytes(sentinel.toPath()),StandardCharsets.UTF_8));
        }
    }
    @Test public void cancellationTerminatesAnActuallyRunningWorker() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        client = new AndroidRuntimeClient(context,scope("source-A","session-A"),(s,u)->{entered.countDown();return "{}";});
        client.connect().get(12,TimeUnit.SECONDS); load(); int pid=client.connect().get().pid();
        CompletableFuture<String> pending=client.invoke("search","{\"fixtureAction\":\"hang\"}",4000);
        assertTrue("Provider must actually enter operation",entered.await(2,TimeUnit.SECONDS));
        assertEquals("WORKER_BUSY",failure(client.invoke("catalogue","{}",4000)));
        assertTrue(pending.cancel(true)); assertProcessGone(pid); assertTrue(client.isClosed());
    }
    @Test public void resultSizeLimitDoesNotPoisonHealthyWorker() throws Exception {
        open(); load();
        assertEquals("PAYLOAD_LIMIT",failure(client.invoke("catalogue","{\"fixtureAction\":\"oversize\"}",4000)));
        assertFalse(client.isClosed()); assertEquals(1,new JSONObject(call("catalogue","{}")).getJSONArray("items").length());
    }
    @Test public void generationCannotBeReplacedInPlace() throws Exception {
        open(); load();
        assertEquals("GENERATION_ALREADY_CLAIMED",failure(client.load(dex,digest,entry)));
        assertEquals(1,new JSONObject(call("catalogue","{}")).getJSONArray("items").length());
    }
    @Test public void trustedOriginSetIsSnapshotted() throws Exception {
        Set<String> origins=new HashSet<>(Arrays.asList("https://fixtures.example"));
        AndroidRuntimeClient.Scope snapshot=new AndroidRuntimeClient.Scope("vantara-test","fixture.package","source-A","session-A",origins);
        origins.add("https://injected.example");
        assertEquals(1,snapshot.allowedOrigins().size());
        try { snapshot.allowedOrigins().add("https://injected.example"); fail("Mutable trusted scope"); }
        catch(UnsupportedOperationException expected) { }
    }

    @Test public void failedInitializerLosesRetainedBrokerCapabilityAndProcess() throws Exception {
        CountDownLatch leakedRequest=new CountDownLatch(1);
        client=new AndroidRuntimeClient(context,scope("source-A","session-A"),(s,u)->{leakedRequest.countDown();return "{}";});
        int pid=client.connect().get(12,TimeUnit.SECONDS).pid();
        assertEquals("PROVIDER_INITIALIZATION_FAILED",failure(client.load(dex,digest,"dev.vantara.runtime.fixtures.FailingProvider")));
        assertFalse("Failed initializer retained broker access",leakedRequest.await(700,TimeUnit.MILLISECONDS));
        assertTrue(client.isClosed()); assertProcessGone(pid);
    }
    private void blockedCompletionCannotHoldRetirement(boolean cancel) throws Exception {
        CountDownLatch entered=new CountDownLatch(1), callbackEntered=new CountDownLatch(1), release=new CountDownLatch(1);
        client=new AndroidRuntimeClient(context,scope("source-A","session-A"),(s,u)->{entered.countDown();return "{}";});
        int pid=client.connect().get(12,TimeUnit.SECONDS).pid(); load();
        CompletableFuture<String> pending=client.invoke("search","{\"fixtureAction\":\"hang\"}",1000);
        assertTrue(entered.await(2,TimeUnit.SECONDS));
        pending.whenComplete((v,e)->{
            callbackEntered.countDown();
            try { release.await(10,TimeUnit.SECONDS); } catch(InterruptedException ignored) { }
        });
        Thread canceller=null;
        if(cancel) { canceller=new Thread(()->pending.cancel(true));canceller.setDaemon(true);canceller.start(); }
        try {
            assertTrue("Completion callback did not enter",callbackEntered.await(3,TimeUnit.SECONDS));
            assertProcessGone(pid); assertTrue(client.isClosed());
        } finally { release.countDown();if(canceller!=null)canceller.join(2000); }
    }
    @Test public void blockingTimeoutCallbackCannotPreventPhysicalRetirement() throws Exception { blockedCompletionCannotHoldRetirement(false); }
    @Test public void blockingCancellationCallbackCannotPreventPhysicalRetirement() throws Exception { blockedCompletionCannotHoldRetirement(true); }
    @Test public void blockedMainLooperCannotPreventPhysicalRetirement() throws Exception {
        CountDownLatch mainEntered=new CountDownLatch(1);
        client=new AndroidRuntimeClient(context,scope("source-A","session-A"),(s,u)->{mainEntered.countDown();return "{}";});
        int pid=client.connect().get(12,TimeUnit.SECONDS).pid(); load();
        assertTrue(new JSONObject(call("details","{\"fixtureAction\":\"block-main\"}")).getBoolean("mainBlocked"));
        assertTrue(mainEntered.await(2,TimeUnit.SECONDS)); client.close(); assertProcessGone(pid);
    }

}
