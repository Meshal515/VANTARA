package dev.vantara.runtime.android;

import org.junit.*;
import java.lang.reflect.Field;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;

/** Admission fails before Parcel/FD creation, so saturated cancellation is testable on the JVM. */
public class RuntimePipesQueueTest {
    private Semaphore writers;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    @Before public void saturate() throws Exception {
        Field field=RuntimePipes.class.getDeclaredField("writers");field.setAccessible(true);
        writers=(Semaphore)field.get(null);assertTrue(writers.tryAcquire(4));
    }
    @After public void cleanup() throws Exception {writers.release(4);executor.shutdownNow();assertTrue(executor.awaitTermination(3,TimeUnit.SECONDS));}
    private String write(AtomicBoolean closed){
        try{RuntimePipes.write(null,new byte[16384],closed::get);return "UNEXPECTED_SUCCESS";}
        catch(RuntimeFailure failure){return failure.code;}
        catch(Exception failure){throw new AssertionError(failure);}
    }
    @Test public void queuedWriterObservesGenerationCancellationBeforeAllocatingAFrame() throws Exception {
        AtomicBoolean closed=new AtomicBoolean();CountDownLatch entered=new CountDownLatch(1);
        Future<String> result=executor.submit(()->{entered.countDown();return write(closed);});assertTrue(entered.await(1,TimeUnit.SECONDS));
        closed.set(true);assertEquals("WORKER_CLOSED",result.get(500,TimeUnit.MILLISECONDS));
    }
    @Test public void interruptionAbortsQueuedWriterAndRetainsInterruptFlag() throws Exception {
        AtomicReference<Thread> thread=new AtomicReference<>();AtomicBoolean interrupted=new AtomicBoolean();CountDownLatch entered=new CountDownLatch(1);
        Future<String> result=executor.submit(()->{thread.set(Thread.currentThread());entered.countDown();String code=write(new AtomicBoolean());interrupted.set(Thread.currentThread().isInterrupted());return code;});
        assertTrue(entered.await(1,TimeUnit.SECONDS));thread.get().interrupt();
        assertEquals("WORKER_CLOSED",result.get(500,TimeUnit.MILLISECONDS));assertTrue(interrupted.get());
    }
    @Test public void saturatedWriterUsesItsAbsoluteBudgetInsteadOfFailingImmediately() throws Exception {
        long start=System.nanoTime();Future<String> result=executor.submit(()->write(new AtomicBoolean()));
        assertEquals("PIPE_TIMEOUT",result.get(3,TimeUnit.SECONDS));
        assertTrue("Saturated writer failed before its bounded admission wait",TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start)>=1500);
    }
}
