package dev.vantara.runtime.android;

import android.os.IBinder;
import android.os.Parcel;
import java.net.URI;
import java.util.*;

final class RuntimeProtocol {
    static final String WORKER="dev.vantara.runtime.worker.v1", BROKER="dev.vantara.runtime.broker.v1";
    static final int HELLO=IBinder.FIRST_CALL_TRANSACTION, LOAD=HELLO+1, INVOKE=HELLO+2, CLOSE=HELLO+3;
    static final int MAX_TEXT=65536, MAX_DEX=8*1024*1024;
    static final Set<String> OPERATIONS=Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "catalogue","search","details","episodes","chapters","pages","videoLinks")));
    static String text(String value) {
        if(value==null || value.length()>MAX_TEXT) throw new RuntimeFailure("PAYLOAD_LIMIT");
        return value;
    }
    static String origin(String value) {
        if(value==null || value.length()>8192 || value.matches("(?s).*[\\x00-\\x20\\x7f].*")) throw new RuntimeFailure("INVALID_ENDPOINT");
        try {
            URI u=new URI(value); String host=u.getHost();
            if(!"https".equalsIgnoreCase(u.getScheme()) || host==null || !host.contains(".") ||
                !host.matches("(?i)[a-z0-9.-]*[a-z]") || host.matches("(?i).*\\.(local|internal|localhost|lan|invalid)") ||
                u.getRawUserInfo()!=null || (u.getPort()!=-1 && u.getPort()!=443)) throw new RuntimeFailure("INVALID_ENDPOINT");
            return "https://"+host.toLowerCase(Locale.ROOT);
        } catch(java.net.URISyntaxException e) { throw new RuntimeFailure("INVALID_ENDPOINT"); }
    }
    static void result(Parcel reply,String code,String payload) {
        reply.writeNoException(); reply.writeString(code); if("OK".equals(code)) reply.writeString(payload);
    }
    static String response(Parcel reply) {
        reply.readException(); String code=reply.readString();
        if(!"OK".equals(code)) throw new RuntimeFailure(code==null?"IPC_CONTRACT":code);
        return text(reply.readString());
    }
    private RuntimeProtocol() {}
}
