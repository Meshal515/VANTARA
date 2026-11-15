package dev.vantara.runtime.android;

import android.content.Context;
import android.os.Build;
import androidx.test.platform.app.InstrumentationRegistry;
import dev.vantara.runtime.api.RuntimeHttpAccess;
import org.junit.Test;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;

/** API26/28: honest unsupported guard only. This is NOT evidence of provider execution on those releases. */
public class PlatformAvailabilityTest {
    @Test public void unsupportedPlatformCannotBindAndRevokesItsUnusedTransport()throws Exception {
        Context host=InstrumentationRegistry.getInstrumentation().getTargetContext();CountDownLatch revoked=new CountDownLatch(1);
        AndroidRuntimeClient.Scope scope=new AndroidRuntimeClient.Scope("cloudstream","platform-probe","not-a-source","not-an-account",new HashSet<>(Arrays.asList("https://fixtures.example")));
        try(AndroidRuntimeClient client=new AndroidRuntimeClient(host,scope,new AndroidRuntimeClient.HostHttpTransport(){
            @Override public RuntimeHttpAccess.Response exchange(AndroidRuntimeClient.Scope owner,RuntimeHttpAccess.Request request){throw new AssertionError("Platform probe must not use networking");}
            @Override public void close(){revoked.countDown();}
        })){
            if(Build.VERSION.SDK_INT<29){
                assertFalse(AndroidRuntimeClient.supportedOnThisPlatform());
                try{client.connect().get(3,TimeUnit.SECONDS);fail("Pretended named workers are available");}
                catch(ExecutionException expected){assertTrue(expected.getCause() instanceof RuntimeFailure);assertEquals("PLATFORM_UNSUPPORTED",((RuntimeFailure)expected.getCause()).code);}
                assertTrue(client.isClosed());assertTrue(revoked.await(3,TimeUnit.SECONDS));
                android.os.ParcelFileDescriptor[] pipe=android.os.ParcelFileDescriptor.createPipe();
                try{
                    try{RuntimePipes.read(pipe[0],1,()->false);fail("Unsupported IPC helper executed");}
                    catch(RuntimeFailure expected){assertEquals("PLATFORM_UNSUPPORTED",expected.code);}
                    try{pipe[0].getFd();fail("Rejected descriptor leaked");}catch(IllegalStateException expected){}
                }finally{pipe[0].close();pipe[1].close();}
            }else{
                assertTrue(AndroidRuntimeClient.supportedOnThisPlatform());AndroidRuntimeClient.Identity worker=client.connect().get(12,TimeUnit.SECONDS);
                assertNotEquals(android.os.Process.myUid(),worker.uid());assertNotEquals(android.os.Process.myPid(),worker.pid());
            }
        }
    }
}
