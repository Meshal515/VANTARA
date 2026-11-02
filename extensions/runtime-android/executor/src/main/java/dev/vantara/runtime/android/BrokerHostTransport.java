package dev.vantara.runtime.android;

import dev.vantara.runtime.api.RuntimeHttpAccess;
import dev.vantara.runtime.http.HttpBroker;
import okhttp3.Headers;
import java.util.*;

/** Host-owned bridge. One immutable worker identity owns one revocable HTTP session. */
public final class BrokerHostTransport implements AndroidRuntimeClient.HostHttpTransport {
    private final AndroidRuntimeClient.Scope owner;
    private final HttpBroker.Session session;

    public BrokerHostTransport(AndroidRuntimeClient.Scope owner,HttpBroker broker) {
        this.owner=Objects.requireNonNull(owner);
        session=Objects.requireNonNull(broker).open(new HttpBroker.Scope(owner.family(),owner.packageId(),owner.sourceId(),owner.sessionId(),owner.allowedOrigins()));
    }

    @Override public RuntimeHttpAccess.Response exchange(AndroidRuntimeClient.Scope caller,RuntimeHttpAccess.Request request) throws Exception {
        if(!owner.equals(caller))throw new RuntimeFailure("SCOPE_MISMATCH");
        if(request==null)throw new RuntimeFailure("INVALID_REQUEST");
        Headers.Builder headers=new Headers.Builder();
        try {
            for(Map.Entry<String,List<String>> row:request.headers().entrySet())
                for(String value:row.getValue())headers.add(row.getKey(),value);
        }catch(IllegalArgumentException|NullPointerException malformed){throw new RuntimeFailure("INVALID_REQUEST_HEADER");}
        try {
            HttpBroker.Output response=session.execute(new HttpBroker.Input(request.url(),request.method(),headers.build(),request.body(),request.followRedirects()));
            return new RuntimeHttpAccess.Response(response.url(),response.status(),response.headers().toMultimap(),response.body());
        }catch(HttpBroker.Failure failure){
            // Retain diagnosis only on the trusted host. IPC serializes the code,
            // never exception causes, response bodies, URLs or session values.
            RuntimeFailure mapped=new RuntimeFailure(failure.code);mapped.initCause(failure);throw mapped;
        }
        catch(IllegalStateException failure){
            String code=failure.getMessage();
            if(!Arrays.asList("COOKIE_STORAGE_CORRUPT","COOKIE_STORAGE_LIMIT","COOKIE_STORAGE_FAILED").contains(code))code="COOKIE_STORAGE_FAILED";
            throw new RuntimeFailure(code);
        }
    }

    /** Read-only host state; no Activity, notification, retry loop or CAPTCHA interaction. */
    public boolean needsVerification(String origin){return session.needsVerification(origin);}
    @Override public void close(){session.close();}
}
