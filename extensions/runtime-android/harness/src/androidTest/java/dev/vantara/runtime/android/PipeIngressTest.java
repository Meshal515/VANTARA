package dev.vantara.runtime.android;

import static org.junit.Assert.*;
import android.os.*;
import org.junit.*;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.*;

/** Real Android FD/Parcel regressions. Keep the remote writer open until after each assertion. */
public class PipeIngressTest {
    Parcel parcel;ParcelFileDescriptor[] pipe;ExecutorService executor;
    @Before public void prepare() throws Exception{parcel=Parcel.obtain();pipe=ParcelFileDescriptor.createPipe();executor=Executors.newSingleThreadExecutor();}
    @After public void cleanup() throws Exception{pipe[1].close();pipe[0].close();parcel.recycle();executor.shutdownNow();assertTrue(executor.awaitTermination(3,TimeUnit.SECONDS));}
    void frame(int size,boolean trailingWriter){parcel.writeInt(size);parcel.writeInt(1);parcel.writeTypedObject(pipe[0],0);if(trailingWriter)parcel.writeTypedObject(pipe[1],0);parcel.setDataPosition(0);}
    String failure() throws Exception{try{RuntimeProtocol.readBytes(parcel,RuntimeProtocol.MAX_REQUEST);return "UNEXPECTED_SUCCESS";}catch(RuntimeFailure failure){return failure.code;}}
    @Test public void trailingWriterDescriptorCannotPinHostThread() throws Exception {
        frame(1,true);assertEquals("IPC_CONTRACT",executor.submit(()->failure()).get(1,TimeUnit.SECONDS));
    }
    @Test public void completeFrameDoesNotWaitForUntrustedEof() throws Exception {
        android.system.Os.write(pipe[1].getFileDescriptor(),new byte[]{17,23,42},0,3);frame(3,false);
        assertArrayEquals(new byte[]{17,23,42},executor.submit(()->RuntimeProtocol.readBytes(parcel,RuntimeProtocol.MAX_REQUEST)).get(1,TimeUnit.SECONDS));
    }
    @Test public void emptyPipeHasAbsoluteDeadline() throws Exception {
        frame(1,false);assertEquals("PIPE_TIMEOUT",executor.submit(()->failure()).get(3,TimeUnit.SECONDS));
    }
    @Test public void blockingSocketDescriptionStillHasAbsoluteReadDeadline() throws Exception {
        // Keep a complete retained pair so lack of bytes cannot become EOF.
        ParcelFileDescriptor[] sockets=ParcelFileDescriptor.createSocketPair();
        try {
            parcel.writeInt(1);parcel.writeInt(1);parcel.writeTypedObject(sockets[0],0);parcel.setDataPosition(0);
            assertEquals("PIPE_TIMEOUT",executor.submit(()->failure()).get(3,TimeUnit.SECONDS));
        }finally{sockets[0].close();sockets[1].close();}
    }
    @Test public void socketFrameCompletesWithPeerStillOpenAndDoesNotMutateFlags() throws Exception {
        ParcelFileDescriptor[] sockets=ParcelFileDescriptor.createSocketPair();
        try {
            long before=flags(sockets[0]);android.system.Os.write(sockets[1].getFileDescriptor(),new byte[]{17,23,42},0,3);
            parcel.writeInt(3);parcel.writeInt(1);parcel.writeTypedObject(sockets[0],0);parcel.setDataPosition(0);
            assertArrayEquals(new byte[]{17,23,42},executor.submit(()->RuntimeProtocol.readBytes(parcel,RuntimeProtocol.MAX_REQUEST)).get(1,TimeUnit.SECONDS));
            assertEquals(before,flags(sockets[0]));
        }finally{sockets[0].close();sockets[1].close();}
    }
    @Test public void generationCancellationStopsIngressBeforePipeDeadline() throws Exception {
        frame(1,false);AtomicBoolean closed=new AtomicBoolean();
        Future<String> result=executor.submit(()->{try{RuntimeProtocol.readBytes(parcel,RuntimeProtocol.MAX_REQUEST,closed::get);return "UNEXPECTED_SUCCESS";}catch(RuntimeFailure expected){return expected.code;}});
        Thread.sleep(100);closed.set(true);assertEquals("WORKER_CLOSED",result.get(1,TimeUnit.SECONDS));
    }
    @Test public void receivedReadEndDoesNotShareNonblockingStatusWithSender() throws Exception {
        long before=flags(pipe[0]);
        android.system.Os.write(pipe[1].getFileDescriptor(),new byte[]{42},0,1);frame(1,false);
        assertArrayEquals(new byte[]{42},RuntimeProtocol.readBytes(parcel,RuntimeProtocol.MAX_REQUEST));
        assertEquals(before,flags(pipe[0]));
    }
    @Test public void unreadOutboundPipesHaveBoundedCapacityAndReleaseItWithoutPeerCooperation() throws Exception {
        List<Parcel> replies=new ArrayList<>();byte[] bytes=new byte[RuntimeProtocol.MAX_RESPONSE];
        try {
            for(int i=0;i<4;i++){Parcel reply=Parcel.obtain();replies.add(reply);RuntimeProtocol.writeBytes(reply,bytes,RuntimeProtocol.MAX_RESPONSE);}
            Parcel queued=Parcel.obtain();replies.add(queued);long start=SystemClock.elapsedRealtime();
            // It may acquire a slot as an old writer expires, or exhaust its own absolute budget.
            try{RuntimeProtocol.writeBytes(queued,bytes,RuntimeProtocol.MAX_RESPONSE);}
            catch(RuntimeFailure expected){assertEquals("PIPE_TIMEOUT",expected.code);}
            assertTrue("Saturated writer did not wait for bounded capacity",SystemClock.elapsedRealtime()-start>=1000);
            assertTrue("Admission exceeded the absolute frame budget",SystemClock.elapsedRealtime()-start<RuntimePipes.MAX_PIPE_MILLIS+1000);
            Parcel recovered=Parcel.obtain();replies.add(recovered);RuntimeProtocol.writeBytes(recovered,bytes,RuntimeProtocol.MAX_RESPONSE);
        }finally{for(Parcel reply:replies)reply.recycle();}
    }
    @Test public void sixIndependentLargeFramesTransferThroughFourWriterSlots() throws Exception {
        ExecutorService transfers=Executors.newFixedThreadPool(8);List<Parcel> frames=new CopyOnWriteArrayList<>();
        List<Future<byte[]>> received=new ArrayList<>();List<Future<Parcel>> queued=new ArrayList<>();
        try {
            for(int i=0;i<4;i++){Parcel frame=largeFrame(i,frames,()->false);received.add(null);frames.get(i).setDataPosition(0);}
            CountDownLatch attempting=new CountDownLatch(2);
            for(int i=4;i<6;i++){final int value=i;queued.add(transfers.submit(()->{attempting.countDown();return largeFrame(value,frames,()->false);}));}
            assertTrue(attempting.await(1,TimeUnit.SECONDS));
            for(Future<Parcel> future:queued)try{future.get(100,TimeUnit.MILLISECONDS);fail("Large frame did not wait for a writer slot");}catch(TimeoutException expected){}
            for(int i=0;i<4;i++){final Parcel frame=frames.get(i);received.set(i,transfers.submit(()->RuntimeProtocol.readBytes(frame,RuntimeProtocol.MAX_RESPONSE)));}
            for(Future<Parcel> future:queued){Parcel frame=future.get(2,TimeUnit.SECONDS);frame.setDataPosition(0);received.add(transfers.submit(()->RuntimeProtocol.readBytes(frame,RuntimeProtocol.MAX_RESPONSE)));}
            for(int i=0;i<6;i++){byte[] expected=new byte[RuntimeProtocol.MAX_RESPONSE];Arrays.fill(expected,(byte)i);assertArrayEquals(expected,received.get(i).get(3,TimeUnit.SECONDS));}
        }finally{transfers.shutdownNow();assertTrue(transfers.awaitTermination(3,TimeUnit.SECONDS));for(Parcel frame:frames)frame.recycle();}
    }
    @Test public void cancelledGenerationStopsQueuedOutboundFrameBeforeAllocation() throws Exception {
        List<Parcel> frames=new CopyOnWriteArrayList<>();AtomicBoolean closed=new AtomicBoolean();CountDownLatch attempting=new CountDownLatch(1);
        try {
            for(int i=0;i<4;i++)largeFrame(i,frames,()->false);
            Future<String> result=executor.submit(()->{attempting.countDown();try{largeFrame(5,frames,closed::get);return "UNEXPECTED_SUCCESS";}catch(RuntimeFailure expected){return expected.code;}});
            assertTrue(attempting.await(1,TimeUnit.SECONDS));closed.set(true);assertEquals("WORKER_CLOSED",result.get(500,TimeUnit.MILLISECONDS));
        }finally{for(Parcel frame:frames)frame.recycle();}
    }
    private Parcel largeFrame(int value,List<Parcel> frames,java.util.function.BooleanSupplier closed) throws Exception {
        Parcel frame=Parcel.obtain();frames.add(frame);byte[] bytes=new byte[RuntimeProtocol.MAX_RESPONSE];Arrays.fill(bytes,(byte)value);
        RuntimeProtocol.writeBytes(frame,bytes,RuntimeProtocol.MAX_RESPONSE,closed);return frame;
    }
    private long flags(ParcelFileDescriptor fd) throws Exception {
        String info=new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get("/proc/self/fdinfo/"+fd.getFd())),java.nio.charset.StandardCharsets.UTF_8);
        java.util.regex.Matcher match=java.util.regex.Pattern.compile("(?m)^flags:\\s+([0-7]+)").matcher(info);
        assertTrue("FD flags metadata missing",match.find());return Long.parseLong(match.group(1),8);
    }
}
