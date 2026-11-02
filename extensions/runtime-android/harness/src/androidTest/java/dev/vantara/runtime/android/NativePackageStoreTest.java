package dev.vantara.runtime.android;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;

/** Real Android filesystem and pinned provider processes. Store reconstruction is NOT an APK/account upgrade. */
public class NativePackageStoreTest {
    @Test public void stageThenRegisterThenActivateAndReloadPublishedPackageWithoutChangingStableId()throws Exception {
        Context host=InstrumentationRegistry.getInstrumentation().getTargetContext(),tests=InstrumentationRegistry.getInstrumentation().getContext();
        Path root=Files.createTempDirectory(host.getFilesDir().toPath(),"package-store-native-");
        Path sentinel=root.resolve("user-repos.json"),archive=root.resolve("download.cs3");Files.write(sentinel,"preserve-existing-repos".getBytes(StandardCharsets.UTF_8));
        try {
            try(InputStream in=tests.getAssets().open("Anime4up.cs3")){Files.copy(in,archive);}
            JSONObject pin;
            try(InputStream in=tests.getAssets().open("Anime4up.json");ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);pin=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
            }
            Path owned=root.resolve("new-family-owned");RuntimePackageStore store=new RuntimePackageStore(owned,"account-one");
            String stableId="stable-native-cloudstream-package";
            AndroidRuntimeClient.Scope scope=new AndroidRuntimeClient.Scope("cloudstream",stableId,"provider-registration","account-one",new HashSet<>(Arrays.asList("https://fixtures.example")));
            AndroidRuntimeClient.Identity first;
            try(RuntimePackageStore.Staged candidate=store.stage(archive.toFile(),pin.getString("packageSha256"));AndroidRuntimeClient client=new AndroidRuntimeClient(host,scope,(owner,url)->{throw new AssertionError("No source traffic during registration");})){
                assertNull(store.current(stableId));
                client.loadCloudStream(candidate.dexFile(),candidate.candidate().dexHash(),candidate.candidate().entry()).get(12,TimeUnit.SECONDS);
                assertTrue(new JSONObject(client.invoke("capabilities","{}",3000).get(5,TimeUnit.SECONDS)).getJSONArray("sources").length()>0);
                first=client.connect().get(1,TimeUnit.SECONDS);candidate.activate(stableId);
            }
            RuntimePackageStore.Installed installed=new RuntimePackageStore(owned,"account-one").current(stableId);
            assertEquals(stableId,installed.packageId());assertEquals(pin.getString("packageSha256"),installed.packageHash());assertEquals(pin.getString("dexSha256"),installed.dexHash());
            try(AndroidRuntimeClient next=new AndroidRuntimeClient(host,scope,(owner,url)->{throw new AssertionError("No source traffic during reload");})){
                next.loadCloudStream(installed.dexFile(),installed.dexHash(),installed.entry()).get(12,TimeUnit.SECONDS);
                assertNotEquals(first.pid(),next.connect().get(1,TimeUnit.SECONDS).pid());assertTrue(new JSONObject(next.invoke("capabilities","{}",3000).get(5,TimeUnit.SECONDS)).getJSONArray("sources").length()>0);
            }
            assertNull(new RuntimePackageStore(owned,"account-two").current(stableId));
            assertEquals("preserve-existing-repos",new String(Files.readAllBytes(sentinel),StandardCharsets.UTF_8));
        }finally{try(java.util.stream.Stream<Path> paths=Files.walk(root)){for(Path p:paths.sorted(Comparator.reverseOrder()).collect(java.util.stream.Collectors.toList()))Files.deleteIfExists(p);}}
    }
}
