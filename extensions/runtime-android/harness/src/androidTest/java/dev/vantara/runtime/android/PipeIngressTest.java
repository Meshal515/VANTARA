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
    @Test public void generationCancellationStopsIngressBeforePipeDeadline() throws Exception {
        frame(1,false);AtomicBoolean closed=new AtomicBoolean();
        Future<String> result=executor.submit(()->{try{RuntimeProtocol.readBytes(parcel,RuntimeProtocol.MAX_REQUEST,closed::get);return "UNEXPECTED_SUCCESS";}catch(RuntimeFailure expected){return expected.code;}});
        Thread.sleep(100);closed.set(true);assertEquals("WORKER_CLOSED",result.get(1,TimeUnit.SECONDS));
    }
    @Test public void receivedReadEndDoesNotShareNonblockingStatusWithSender() throws Exception {
        int before=android.system.Os.fcntlInt(pipe[0].getFileDescriptor(),android.system.OsConstants.F_GETFL,0);
        android.system.Os.write(pipe[1].getFileDescriptor(),new byte[]{42},0,1);frame(1,false);
        assertArrayEquals(new byte[]{42},RuntimeProtocol.readBytes(parcel,RuntimeProtocol.MAX_REQUEST));
        assertEquals(before,android.system.Os.fcntlInt(pipe[0].getFileDescriptor(),android.system.OsConstants.F_GETFL,0));
    }
    @Test public void unreadOutboundPipesHaveBoundedCapacityAndReleaseItWithoutPeerCooperation() throws Exception {
        List<Parcel> replies=new ArrayList<>();byte[] bytes=new byte[RuntimeProtocol.MAX_RESPONSE];
        try {
            for(int i=0;i<4;i++){Parcel reply=Parcel.obtain();replies.add(reply);RuntimeProtocol.writeBytes(reply,bytes,RuntimeProtocol.MAX_RESPONSE);}
            Parcel rejected=Parcel.obtain();replies.add(rejected);
            try{RuntimeProtocol.writeBytes(rejected,bytes,RuntimeProtocol.MAX_RESPONSE);fail("Unbounded pipe writers accepted");}catch(RuntimeFailure expected){assertEquals("PIPE_CAPACITY",expected.code);}
            long deadline=SystemClock.elapsedRealtime()+RuntimePipes.MAX_PIPE_MILLIS+1000;boolean recovered=false;
            do {
                Parcel candidate=Parcel.obtain();replies.add(candidate);
                try{RuntimeProtocol.writeBytes(candidate,bytes,RuntimeProtocol.MAX_RESPONSE);recovered=true;break;}
                catch(RuntimeFailure expected){assertEquals("PIPE_CAPACITY",expected.code);}
                Thread.sleep(50);
            }while(SystemClock.elapsedRealtime()<deadline);
            assertTrue("Unconsumed peer permanently retained host writer capacity",recovered);
        }finally{for(Parcel reply:replies)reply.recycle();}
    }
}
