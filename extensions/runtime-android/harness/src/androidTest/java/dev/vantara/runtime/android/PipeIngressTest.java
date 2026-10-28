package dev.vantara.runtime.android;

import static org.junit.Assert.*;
import android.os.*;
import org.junit.*;
import java.io.*;
import java.util.concurrent.*;

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
}
