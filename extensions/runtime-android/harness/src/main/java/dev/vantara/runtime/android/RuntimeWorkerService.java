package dev.vantara.runtime.android;

import android.app.Service;
import android.content.Intent;
import android.os.*;
import dalvik.system.InMemoryDexClassLoader;
import dev.vantara.runtime.api.RuntimeAccess;
import dev.vantara.runtime.api.RuntimeProvider;
import java.io.*;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/** Independent lab worker. The OS supplies a distinct UID with no app permissions. */
public final class RuntimeWorkerService extends Service {
    private final AtomicBoolean busy=new AtomicBoolean(), claimed=new AtomicBoolean();
    private volatile RuntimeProvider provider;
    private volatile RuntimeAccess access;
    private final Binder endpoint=new Binder() {
        @Override protected boolean onTransact(int code,Parcel data,Parcel reply,int flags) throws RemoteException {
            if(code<RuntimeProtocol.HELLO || code>RuntimeProtocol.CLOSE) return super.onTransact(code,data,reply,flags);
            if(Binder.getCallingUid()!=getApplicationInfo().uid) throw new SecurityException("Not the owning host");
            data.enforceInterface(RuntimeProtocol.WORKER);
            if(code==RuntimeProtocol.HELLO) {
                RuntimeProtocol.result(reply,"OK",android.os.Process.myPid()+":"+android.os.Process.myUid()); return true;
            }
            if(code==RuntimeProtocol.CLOSE) {
                RuntimeProtocol.result(reply,"OK","");
                new Handler(Looper.getMainLooper()).postDelayed(()->android.os.Process.killProcess(android.os.Process.myPid()),10);
                return true;
            }
            if(!busy.compareAndSet(false,true)) { RuntimeProtocol.result(reply,"WORKER_BUSY",null);return true; }
            try {
                if(code==RuntimeProtocol.LOAD) load(data,reply);
                else invoke(data,reply);
            } catch(VirtualMachineError fatal) {
                android.os.Process.killProcess(android.os.Process.myPid()); throw fatal;
            } catch(RuntimeFailure failure) { RuntimeProtocol.result(reply,failure.code,null); }
            catch(Throwable failure) { RuntimeProtocol.result(reply,"IPC_CONTRACT",null); }
            finally { busy.set(false); }
            return true;
        }
    };
    @Override public IBinder onBind(Intent intent) { return endpoint; }

    private byte[] readDex(ParcelFileDescriptor fd,String expected) throws Exception {
        if(fd==null) throw new RuntimeFailure("INVALID_DEX_INPUT");
        try(InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(fd); ByteArrayOutputStream bytes=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[8192]; int count,total=0;
            while((count=input.read(buffer))!=-1) {
                total+=count; if(total>RuntimeProtocol.MAX_DEX) throw new RuntimeFailure("DEX_SIZE_LIMIT");
                bytes.write(buffer,0,count);
            }
            byte[] dex=bytes.toByteArray();
            if(dex.length<112) throw new RuntimeFailure("INVALID_DEX_INPUT");
            StringBuilder hex=new StringBuilder();
            for(byte b:MessageDigest.getInstance("SHA-256").digest(dex)) hex.append(String.format(Locale.ROOT,"%02x",b&255));
            if(expected==null || !expected.matches("[0-9a-f]{64}") || !expected.equals(hex.toString())) throw new RuntimeFailure("HASH_MISMATCH");
            return dex;
        }
    }
    private void load(Parcel data,Parcel reply) throws Exception {
        String expected=data.readString(), entry=data.readString();
        ParcelFileDescriptor descriptor=data.readTypedObject(ParcelFileDescriptor.CREATOR);
        IBinder broker=data.readStrongBinder();
        if(!claimed.compareAndSet(false,true)) {
            if(descriptor!=null) descriptor.close();
            throw new RuntimeFailure("GENERATION_ALREADY_CLAIMED");
        }
        byte[] dex=readDex(descriptor,expected);
        if(entry==null || entry.length()>512 || broker==null) throw new RuntimeFailure("INVALID_DEX_INPUT");
        RuntimeProvider candidate;
        try {
            InMemoryDexClassLoader loader=new InMemoryDexClassLoader(ByteBuffer.wrap(dex),RuntimeProvider.class.getClassLoader());
            Class<?> type=Class.forName(entry,false,loader);
            if(type.getClassLoader()!=loader || !RuntimeProvider.class.isAssignableFrom(type)) throw new RuntimeFailure("ABI_MISMATCH");
            candidate=(RuntimeProvider)type.getDeclaredConstructor().newInstance();
        } catch(RuntimeFailure e) { throw e; }
        catch(ReflectiveOperationException | LinkageError e) { throw new RuntimeFailure("ABI_MISMATCH"); }
        RuntimeAccess candidateAccess=url->{
            RuntimeProtocol.text(url);
            Parcel request=Parcel.obtain(), answer=Parcel.obtain();
            try {
                request.writeInterfaceToken(RuntimeProtocol.BROKER); request.writeString(url);
                if(!broker.transact(RuntimeProtocol.HELLO,request,answer,0)) throw new BrokerRejected("BROKER_UNAVAILABLE");
                try { return RuntimeProtocol.response(answer); }
                catch(RuntimeFailure e) { throw new BrokerRejected(e.code); }
            } finally { request.recycle();answer.recycle(); }
        };
        try { candidate.initialize(candidateAccess); }
        catch(VirtualMachineError e) { throw e; }
        catch(LinkageError e) { throw new RuntimeFailure("ABI_MISMATCH"); }
        catch(Throwable e) { throw new RuntimeFailure("PROVIDER_INITIALIZATION_FAILED"); }
        // Publication is the final step; failed candidates never become callable.
        access=candidateAccess;provider=candidate;
        RuntimeProtocol.result(reply,"OK","");
    }
    private void invoke(Parcel data,Parcel reply) {
        String operation=RuntimeProtocol.text(data.readString()), input=RuntimeProtocol.text(data.readString());
        if(!RuntimeProtocol.OPERATIONS.contains(operation)) throw new RuntimeFailure("CAPABILITY_UNSUPPORTED");
        RuntimeProvider current=provider; if(current==null) throw new RuntimeFailure("PROVIDER_NOT_READY");
        final String result;
        try { result=current.invoke(operation,input,access); }
        catch(BrokerRejected e) { throw new RuntimeFailure(e.code); }
        catch(VirtualMachineError e) { throw e; }
        catch(LinkageError e) { throw new RuntimeFailure("ABI_MISMATCH"); }
        catch(Throwable e) { throw new RuntimeFailure("PROVIDER_FAILED"); }
        RuntimeProtocol.result(reply,"OK",RuntimeProtocol.text(result));
    }
    private static final class BrokerRejected extends Exception {
        final String code;
        BrokerRejected(String code) { super(code);this.code=code; }
    }
}
