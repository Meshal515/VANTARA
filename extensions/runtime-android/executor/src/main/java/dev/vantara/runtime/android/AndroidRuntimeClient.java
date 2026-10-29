package dev.vantara.runtime.android;

import android.content.*;
import android.os.*;
import dev.vantara.runtime.api.RuntimeHttpAccess;
import java.io.File;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** A single physical worker generation. It is never restarted or reused after retirement. */
public final class AndroidRuntimeClient implements AutoCloseable {
    private static final Semaphore httpIngress=new Semaphore(8);
    /** In-flight HTTP exchanges one worker generation may hold; providers fan out across an episode's servers. */
    private final Semaphore workerExchanges=new Semaphore(6);
    public interface HostTransport { String request(Scope scope,String url) throws Exception; }
    public interface HostHttpTransport extends HostTransport,AutoCloseable {
        RuntimeHttpAccess.Response exchange(Scope scope,RuntimeHttpAccess.Request request) throws Exception;
        @Override default String request(Scope scope,String url) throws Exception {
            return new String(exchange(scope,new RuntimeHttpAccess.Request(url,"GET",Collections.emptyMap(),null,true)).body(),java.nio.charset.StandardCharsets.UTF_8);
        }
        @Override default void close(){}
    }
    public record Scope(String family,String packageId,String sourceId,String sessionId,Set<String> allowedOrigins) {
        public Scope {
            for(String value:Arrays.asList(family,packageId,sourceId,sessionId))
                if(value==null || value.isEmpty() || value.length()>200) throw new IllegalArgumentException("Invalid runtime identity");
            if(allowedOrigins==null || allowedOrigins.isEmpty() || allowedOrigins.size()>32) throw new IllegalArgumentException("Invalid origin permissions");
            Set<String> origins=new HashSet<>();
            if(allowedOrigins.contains(RuntimeProtocol.PUBLIC_INTERNET)) origins.add(RuntimeProtocol.PUBLIC_INTERNET);
            else for(String origin:allowedOrigins) origins.add(RuntimeProtocol.origin(origin));
            allowedOrigins=Collections.unmodifiableSet(origins);
        }
    }
    public record Identity(int pid,int uid) {}
    private final Context context;
    private final Scope scope;
    private final HostTransport transport;
    private final ExecutorService io=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"vrt-call");t.setDaemon(true);return t;});
    private final ScheduledExecutorService clock=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"vrt-deadline");t.setDaemon(true);return t;});
    private final AtomicBoolean started=new AtomicBoolean(),closed=new AtomicBoolean(),busy=new AtomicBoolean(),brokerBusy=new AtomicBoolean();
    private final CompletableFuture<Identity> ready=new CompletableFuture<>();
    private final AtomicReference<OperationFuture<?>> current=new AtomicReference<>();
    private volatile IBinder endpoint;
    private volatile Identity identity;
    private boolean bound;
    private final ServiceConnection connection=new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name,IBinder service) {
            if(closed.get()) return;
            endpoint=service;
            try { service.linkToDeath(()->retire("PROCESS_DIED",false),0); }
            catch(RemoteException e) { retire("PROCESS_DIED",false);return; }
            try { io.execute(()->{
                try {
                    String[] fields=transact(RuntimeProtocol.HELLO,p->{}).split(":");
                    if(fields.length!=2) throw new RuntimeFailure("IPC_CONTRACT");
                    Identity id=new Identity(Integer.parseInt(fields[0]),Integer.parseInt(fields[1]));
                    if(id.pid()<=0 || id.uid()<0 || id.pid()==android.os.Process.myPid() || id.uid()==android.os.Process.myUid()) throw new RuntimeFailure("ISOLATION_REQUIRED");
                    identity=id;ready.complete(id);
                } catch(Throwable e) { retire(e instanceof RuntimeFailure?((RuntimeFailure)e).code:"IPC_CONTRACT",true); }
            }); } catch(RejectedExecutionException e) { retire("WORKER_CLOSED",true); }
        }
        @Override public void onServiceDisconnected(ComponentName name) { retire("PROCESS_DIED",false); }
        @Override public void onBindingDied(ComponentName name) { retire("PROCESS_DIED",false); }
        @Override public void onNullBinding(ComponentName name) { retire("BINDING_FAILED",false); }
    };
    public AndroidRuntimeClient(Context context,Scope scope,HostTransport transport) {
        this.context=Objects.requireNonNull(context).getApplicationContext();
        this.scope=Objects.requireNonNull(scope);this.transport=transport;
    }
    /** Library can coexist with existing API26+ engines; named isolated workers require Android10/API29. */
    public static boolean supportedOnThisPlatform(){return Build.VERSION.SDK_INT>=29;}
    public CompletableFuture<Identity> connect() {
        if(Build.VERSION.SDK_INT<29){retire("PLATFORM_UNSUPPORTED",false);return ready;}
        synchronized(this) {
            if(closed.get()) return failed("WORKER_CLOSED");
            if(started.compareAndSet(false,true)) {
                try {
                    bound=context.bindIsolatedService(new Intent(context,RuntimeWorkerService.class),Context.BIND_AUTO_CREATE,
                        "generation_"+UUID.randomUUID().toString().replace("-",""),context.getMainExecutor(),connection);
                    if(!bound) retire("BINDING_FAILED",false);
                    else clock.schedule(()->{if(!ready.isDone()) retire("BINDING_TIMEOUT",true);},10000,TimeUnit.MILLISECONDS);
                } catch(RuntimeException e) { retire("BINDING_FAILED",false); }
            }
        }
        return ready;
    }
    public CompletableFuture<Void> load(File dex,String hash,String entry) {
        return loadProfile(dex,hash,entry,false);
    }
    public CompletableFuture<Void> loadCloudStream(File dex,String hash,String entry) {
        if(!"cloudstream".equals(scope.family()))return failed("PROFILE_IDENTITY_MISMATCH");
        return loadProfile(dex,hash,entry,true);
    }
    private CompletableFuture<Void> loadProfile(File dex,String hash,String entry,boolean cloudstream) {
        if(dex==null || hash==null || entry==null) return failed("INVALID_DEX_INPUT");
        return submit(10000,true,()->{
            try(ParcelFileDescriptor fd=ParcelFileDescriptor.open(dex,ParcelFileDescriptor.MODE_READ_ONLY)) {
                transact(cloudstream?RuntimeProtocol.LOAD_CLOUDSTREAM:RuntimeProtocol.LOAD,p->{p.writeString(hash);p.writeString(entry);p.writeTypedObject(fd,0);p.writeStrongBinder(broker);});
                return null;
            }
        });
    }
    public CompletableFuture<String> invoke(String operation,String input,long timeoutMs) {
        if(closed.get()) return failed("WORKER_CLOSED");
        if(!RuntimeProtocol.OPERATIONS.contains(operation)) return failed("CAPABILITY_UNSUPPORTED");
        try { RuntimeProtocol.text(input); }
        catch(RuntimeFailure e) { return failed(e.code); }
        return submit(timeoutMs,false,()->transact(RuntimeProtocol.INVOKE,p->{p.writeString(operation);p.writeString(input);}));
    }
    /** Bounded UTF8 JSON result over existing FD transport; caller still validates its operation-specific JSON shape. */
    public CompletableFuture<String> invokeJson(String operation,String input,long timeoutMs) {
        if(closed.get())return failed("WORKER_CLOSED");
        if(!RuntimeProtocol.OPERATIONS.contains(operation))return failed("CAPABILITY_UNSUPPORTED");
        try{RuntimeProtocol.text(input);}catch(RuntimeFailure failure){return failed(failure.code);}
        return submit(timeoutMs,false,()->transact(RuntimeProtocol.INVOKE_JSON,p->{p.writeString(operation);p.writeString(input);}));
    }
    private final class OperationFuture<T> extends CompletableFuture<T> {
        volatile boolean cancellationRequested;
        volatile ScheduledFuture<?> deadline;
        @Override public boolean cancel(boolean interrupt) {
            if(isDone()) return false;
            cancellationRequested=true;
            // Run independently of the order/blocking behavior of user callbacks.
            retire("OPERATION_CANCELLED",true,this);
            return super.cancel(interrupt);
        }
    }
    private <T> CompletableFuture<T> submit(long timeoutMs,boolean initialLoad,Callable<T> operation) {
        if(closed.get()) return failed("WORKER_CLOSED");
        if(timeoutMs<1 || timeoutMs>30000) return failed("INVALID_DEADLINE");
        if(!busy.compareAndSet(false,true)) return failed("WORKER_BUSY");
        OperationFuture<T> result=new OperationFuture<>();current.set(result);
        final ScheduledFuture<?> deadline;
        try { deadline=clock.schedule(()->{
            if(current.get()==result) retire("OPERATION_TIMEOUT",true);
        },timeoutMs,TimeUnit.MILLISECONDS); }
        catch(RejectedExecutionException e) { finish(result,null,new RuntimeFailure("WORKER_CLOSED"));return result; }
        result.deadline=deadline;
        connect().whenComplete((value,error)->{
            if(error!=null) { finish(result,null,error);return; }
            if(closed.get()) { finish(result,null,new RuntimeFailure("WORKER_CLOSED"));return; }
            try { io.execute(()->{
                if(closed.get()) { finish(result,null,new RuntimeFailure("WORKER_CLOSED"));return; }
                try { T answer=operation.call();finish(result,answer,null); }
                catch(Throwable cause) {
                    if(cause instanceof DeadObjectException || cause instanceof RemoteException) {
                        retire("PROCESS_DIED",false);finish(result,null,new RuntimeFailure("PROCESS_DIED"));
                    } else {
                        RuntimeFailure failure=cause instanceof RuntimeFailure?(RuntimeFailure)cause:new RuntimeFailure("IPC_CONTRACT");
                        // A rejected repeat load did not run candidate code. Every
                        // failed initial candidate loses its process and capabilities.
                        if(initialLoad && !"GENERATION_ALREADY_CLAIMED".equals(failure.code)) retire(failure.code,true);
                        finish(result,null,failure);
                    }
                }
            }); } catch(RejectedExecutionException e) { finish(result,null,new RuntimeFailure("WORKER_CLOSED")); }
        });
        return result;
    }
    private <T> void finish(OperationFuture<T> result,T value,Throwable failure) {
        if(result.cancellationRequested) return;
        if(current.compareAndSet(result,null)) busy.set(false);
        if(result.deadline!=null) result.deadline.cancel(false);
        if(failure==null) result.complete(value);else result.completeExceptionally(failure);
    }
    private interface Writer { void write(Parcel parcel) throws Exception; }
    private String transact(int code,Writer writer) throws Exception {
        IBinder target=endpoint;if(target==null) throw new RuntimeFailure("WORKER_CLOSED");
        Parcel data=Parcel.obtain(),reply=Parcel.obtain();
        try {
            data.writeInterfaceToken(RuntimeProtocol.WORKER);writer.write(data);
            if(!target.transact(code,data,reply,0)) throw new RuntimeFailure("IPC_CONTRACT");
            return code==RuntimeProtocol.INVOKE_JSON?RuntimeProtocol.jsonResponse(reply,closed::get):RuntimeProtocol.response(reply);
        } finally { data.recycle();reply.recycle(); }
    }
    private final Binder broker=new Binder() {
        @Override protected boolean onTransact(int code,Parcel data,Parcel reply,int flags) throws RemoteException {
            if(code!=RuntimeProtocol.HELLO&&code!=RuntimeProtocol.HTTP_EXCHANGE) return super.onTransact(code,data,reply,flags);
            Identity worker=identity;
            if(worker==null || closed.get() || Binder.getCallingUid()!=worker.uid() || Binder.getCallingPid()!=worker.pid()) throw new SecurityException("Not the owning worker generation");
            data.enforceInterface(RuntimeProtocol.BROKER);
            if(code==RuntimeProtocol.HTTP_EXCHANGE){exchange(data,reply);return true;}
            try {
                String url=RuntimeProtocol.text(data.readString()), origin=RuntimeProtocol.origin(url);
                if(!scope.allowedOrigins().contains(origin)) throw new RuntimeFailure("ORIGIN_NOT_ALLOWED");
                if(transport==null) throw new RuntimeFailure("BROKER_UNAVAILABLE");
                if(!brokerBusy.compareAndSet(false,true)) throw new RuntimeFailure("WORKER_BUSY");
                final String response;
                long callingIdentity=Binder.clearCallingIdentity();
                try { response=RuntimeProtocol.text(transport.request(scope,url)); }
                finally { Binder.restoreCallingIdentity(callingIdentity);brokerBusy.set(false); }
                if(closed.get()) throw new RuntimeFailure("WORKER_CLOSED");
                RuntimeProtocol.result(reply,"OK",response);
            } catch(RuntimeFailure e) { RuntimeProtocol.result(reply,e.code,null); }
            catch(Exception e) { RuntimeProtocol.result(reply,"TRANSPORT_FAILED",null); }
            return true;
        }
    };
    private void exchange(Parcel data,Parcel reply) {
        boolean admitted=false,owned=false;
        try {
            if(!httpIngress.tryAcquire(15,TimeUnit.SECONDS))throw new RuntimeFailure("ENGINE_BUSY");admitted=true;
            if(!workerExchanges.tryAcquire())throw new RuntimeFailure("WORKER_BUSY");owned=true;
            RuntimeHttpAccess.Request request=RuntimeProtocol.readRequest(data,closed::get);
            if(closed.get())throw new RuntimeFailure("WORKER_CLOSED");
            if(scope.allowedOrigins().contains(RuntimeProtocol.PUBLIC_INTERNET)) RuntimeProtocol.publicUrl(request.url());
            else if(!scope.allowedOrigins().contains(RuntimeProtocol.origin(request.url())))throw new RuntimeFailure("ORIGIN_NOT_ALLOWED");
            if(!(transport instanceof HostHttpTransport))throw new RuntimeFailure("FULL_HTTP_UNSUPPORTED");
            RuntimeHttpAccess.Response response;long identity=Binder.clearCallingIdentity();
            try {response=((HostHttpTransport)transport).exchange(scope,request);}
            finally {Binder.restoreCallingIdentity(identity);}
            if(closed.get())throw new RuntimeFailure("WORKER_CLOSED");
            Parcel payload=Parcel.obtain();
            try {RuntimeProtocol.writeHttpResponse(payload,response,closed::get);reply.writeNoException();reply.writeString("OK");reply.appendFrom(payload,0,payload.dataSize());}
            finally {payload.recycle();}
        }catch(RuntimeFailure failure){RuntimeProtocol.result(reply,failure.code,null);}
        catch(Exception failure){RuntimeProtocol.result(reply,"TRANSPORT_FAILED",null);}
        finally{if(owned)workerExchanges.release();if(admitted)httpIngress.release();}
    }
    private void retire(String reason,boolean terminate) { retire(reason,terminate,null); }
    private void retire(String reason,boolean terminate,OperationFuture<?> cancelled) {
        if(!closed.compareAndSet(false,true)) return;
        OperationFuture<?> active=current.getAndSet(null);
        IBinder target=endpoint;
        // Initiate guaranteed cleanup BEFORE notifying any user-controlled future
        // callback. Never wait for an acknowledgement from a possibly hung worker.
        Thread control=new Thread(()->{
            try {
                if(terminate && target!=null) {
                    Parcel data=Parcel.obtain();
                    try { data.writeInterfaceToken(RuntimeProtocol.WORKER);target.transact(RuntimeProtocol.CLOSE,data,null,IBinder.FLAG_ONEWAY); }
                    finally { data.recycle(); }
                }
            } catch(Exception ignored) { /* Retired generations are never reused. */ }
            finally {
                synchronized(AndroidRuntimeClient.this) {
                    if(bound) {bound=false;try {context.unbindService(connection);}catch(IllegalArgumentException ignored) {}}
                }
                if(transport instanceof HostHttpTransport)try{((HostHttpTransport)transport).close();}catch(RuntimeException ignored){}
            }
        },"vrt-retire");
        control.setDaemon(true);control.start();io.shutdownNow();clock.shutdownNow();
        ready.completeExceptionally(new RuntimeFailure(reason));
        if(active!=null && active!=cancelled) active.completeExceptionally(new RuntimeFailure(reason));
    }
    private static <T> CompletableFuture<T> failed(String code) {
        CompletableFuture<T> result=new CompletableFuture<>();result.completeExceptionally(new RuntimeFailure(code));return result;
    }
    public boolean isClosed() { return closed.get(); }
    @Override public void close() { retire("WORKER_CLOSED",true); }
}
