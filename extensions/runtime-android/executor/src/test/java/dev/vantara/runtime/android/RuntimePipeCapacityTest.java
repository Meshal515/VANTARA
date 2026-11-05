package dev.vantara.runtime.android;

import org.junit.Test;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;

public class RuntimePipeCapacityTest {
    @Test public void sixIndependentFramesQueueAndCompleteWithOnlyFourActiveWriters() throws Exception {
        Semaphore capacity=new Semaphore(4,true);ExecutorService executor=Executors.newFixedThreadPool(6);
        CountDownLatch entered=new CountDownLatch(4),release=new CountDownLatch(1);AtomicInteger active=new AtomicInteger(),peak=new AtomicInteger();
        List<Future<String>> frames=new ArrayList<>();
        Callable<String> frame=()->{
            RuntimePipeCapacity.acquire(capacity,()->false,System.nanoTime()+TimeUnit.SECONDS.toNanos(2));
            int current=active.incrementAndGet();peak.accumulateAndGet(current,Math::max);entered.countDown();
            try{release.await();return "frame transferred";}finally{active.decrementAndGet();capacity.release();}
        };
        try {
            for(int i=0;i<4;i++)frames.add(executor.submit(frame));assertTrue(entered.await(1,TimeUnit.SECONDS));
            for(int i=0;i<2;i++)frames.add(executor.submit(frame));
            for(int i=4;i<6;i++)try{frames.get(i).get(100,TimeUnit.MILLISECONDS);fail("Frame did not queue behind the bounded writers");}catch(TimeoutException expected){}
            release.countDown();for(Future<String> result:frames)assertEquals("frame transferred",result.get(1,TimeUnit.SECONDS));
            assertEquals(4,peak.get());assertEquals(4,capacity.availablePermits());
        }finally{release.countDown();executor.shutdownNow();assertTrue(executor.awaitTermination(3,TimeUnit.SECONDS));}
    }

    @Test public void cancellationRacingWithAdmissionDoesNotLeakAWriterPermit() {
        Semaphore capacity=new Semaphore(1,true);AtomicInteger checks=new AtomicInteger();
        try{RuntimePipeCapacity.acquire(capacity,()->checks.incrementAndGet()>1,System.nanoTime()+TimeUnit.SECONDS.toNanos(1));fail("Closed frame was admitted");}
        catch(RuntimeFailure expected){assertEquals("WORKER_CLOSED",expected.code);}
        assertEquals(1,capacity.availablePermits());
    }

    @Test public void expiredFrameDoesNotTakeAvailableCapacity() {
        Semaphore capacity=new Semaphore(1,true);
        try{RuntimePipeCapacity.acquire(capacity,()->false,System.nanoTime()-1);fail("Expired frame was admitted");}
        catch(RuntimeFailure expected){assertEquals("PIPE_TIMEOUT",expected.code);}
        assertEquals(1,capacity.availablePermits());
    }
}
