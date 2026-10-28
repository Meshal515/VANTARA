package dev.vantara.runtime.android;

import android.os.*;
import android.system.*;
import java.io.*;
import java.util.concurrent.Semaphore;
import java.util.function.BooleanSupplier;

/** Local IPC deadlines, independent of network deadlines and worker cooperation. */
final class RuntimePipes {
    static final long MAX_PIPE_MILLIS=2000;
    // Stable Linux UAPI values on Android's supported ARM/x86 ABIs. OsConstants
    // does not expose these flags. Per-call flags cannot be cleared by the peer.
    private static final int MSG_DONTWAIT=0x40,MSG_NOSIGNAL=0x4000;
    private static final Semaphore writers=new Semaphore(4);
    private static void active(BooleanSupplier closed,long deadline) {
        if(closed.getAsBoolean())throw new RuntimeFailure("WORKER_CLOSED");
        if(SystemClock.elapsedRealtime()>=deadline)throw new RuntimeFailure("PIPE_TIMEOUT");
    }
    private static void ready(FileDescriptor fd,short events,BooleanSupplier closed,long deadline) throws ErrnoException {
        StructPollfd poll=new StructPollfd();poll.fd=fd;poll.events=events;
        for(;;){active(closed,deadline);try{if(Os.poll(new StructPollfd[]{poll},(int)Math.min(50,Math.max(1,deadline-SystemClock.elapsedRealtime())))>0){active(closed,deadline);return;}}catch(ErrnoException e){if(e.errno!=OsConstants.EINTR)throw e;}}
    }
    static byte[] read(ParcelFileDescriptor incoming,int length,BooleanSupplier closed) throws IOException {
        FileDescriptor independent=null;
        try(ParcelFileDescriptor original=incoming) {
            long deadline=SystemClock.elapsedRealtime()+MAX_PIPE_MILLIS;active(closed,deadline);
            StructStat before=Os.fstat(original.getFileDescriptor());
            if((before.st_mode&OsConstants.S_IFMT)==OsConstants.S_IFSOCK) {
                byte[] result=new byte[length];int offset=0;
                while(offset<length) {
                    ready(original.getFileDescriptor(),(short)(OsConstants.POLLIN|OsConstants.POLLHUP|OsConstants.POLLERR),closed,deadline);
                    try{int n=Os.recvfrom(original.getFileDescriptor(),result,offset,Math.min(8192,length-offset),MSG_DONTWAIT,null);if(n==0)throw new RuntimeFailure("IPC_CONTRACT");offset+=n;}
                    catch(ErrnoException e){if(e.errno!=OsConstants.EAGAIN&&e.errno!=OsConstants.EINTR)throw e;}
                }
                active(closed,deadline);return result;
            }
            if((before.st_mode&OsConstants.S_IFMT)!=OsConstants.S_IFIFO)throw new RuntimeFailure("IPC_CONTRACT");
            // dup() would still share O_NONBLOCK with the malicious sender. Reopen
            // while keeping the original FD alive to obtain independent status flags.
            independent=Os.open("/proc/self/fd/"+original.getFd(),OsConstants.O_RDONLY|OsConstants.O_NONBLOCK|OsConstants.O_CLOEXEC,0);
            StructStat after=Os.fstat(independent);
            if(before.st_dev!=after.st_dev||before.st_ino!=after.st_ino||(after.st_mode&OsConstants.S_IFMT)!=OsConstants.S_IFIFO)throw new RuntimeFailure("IPC_CONTRACT");
            byte[] result=new byte[length];int offset=0;
            while(offset<length) {
                ready(independent,(short)(OsConstants.POLLIN|OsConstants.POLLHUP|OsConstants.POLLERR),closed,deadline);
                try{int n=Os.read(independent,result,offset,Math.min(8192,length-offset));if(n==0)throw new RuntimeFailure("IPC_CONTRACT");offset+=n;}
                catch(ErrnoException e){if(e.errno!=OsConstants.EAGAIN&&e.errno!=OsConstants.EINTR)throw e;}
            }
            // The declared frame length completes the message. EOF is controlled by
            // the sender and is neither needed nor safe to wait for.
            active(closed,deadline);return result;
        }catch(ErrnoException e){throw new RuntimeFailure("PIPE_CAPABILITY_UNSUPPORTED");}
        finally{if(independent!=null)try{Os.close(independent);}catch(ErrnoException ignored){}}
    }
    static void write(Parcel parcel,byte[] bytes,BooleanSupplier closed) throws IOException {
        if(!writers.tryAcquire())throw new RuntimeFailure("PIPE_CAPACITY");
        ParcelFileDescriptor[] ends=null;
        try {
            if(closed.getAsBoolean())throw new RuntimeFailure("WORKER_CLOSED");
            // Unix stream sockets support per-call nonblocking I/O across UIDs.
            // Reopening a peer-owned FIFO is correctly denied by Android; mutable
            // shared fcntl flags are not a safe substitute for MSG_DONTWAIT.
            ends=ParcelFileDescriptor.createSocketPair();
            parcel.writeTypedObject(ends[0],0);ends[0].close();
            ParcelFileDescriptor output=ends[1];
            long deadline=SystemClock.elapsedRealtime()+MAX_PIPE_MILLIS;
            Thread writer=new Thread(()->{
                try(ParcelFileDescriptor owned=output) {
                    int offset=0;
                    while(offset<bytes.length) {
                        ready(owned.getFileDescriptor(),(short)(OsConstants.POLLOUT|OsConstants.POLLERR),closed,deadline);
                        try{offset+=Os.sendto(owned.getFileDescriptor(),bytes,offset,Math.min(8192,bytes.length-offset),MSG_DONTWAIT|MSG_NOSIGNAL,(java.net.InetAddress)null,0);}
                        catch(ErrnoException e){if(e.errno!=OsConstants.EAGAIN&&e.errno!=OsConstants.EINTR)throw e;}
                    }
                }catch(IOException|ErrnoException|RuntimeFailure ignored){/* Receiver sees an incomplete frame, never success. */}
                finally{writers.release();}
            },"vrt-pipe");
            writer.setDaemon(true);writer.start();
        }catch(Throwable failure) {
            if(ends!=null)for(ParcelFileDescriptor end:ends)try{end.close();}catch(IOException ignored){}
            writers.release();if(failure instanceof IOException)throw (IOException)failure;
            if(failure instanceof RuntimeException)throw (RuntimeException)failure;
            if(failure instanceof Error)throw (Error)failure;
            throw new RuntimeFailure("PIPE_CAPABILITY_UNSUPPORTED");
        }
    }
    private RuntimePipes(){}
}
