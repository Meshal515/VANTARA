package dev.vantara.runtime.android;

import android.os.IBinder;
import android.os.Parcel;
import android.os.ParcelFileDescriptor;
import dev.vantara.runtime.api.RuntimeHttpAccess;
import java.io.*;
import java.util.function.BooleanSupplier;
import java.net.URI;
import java.util.*;

final class RuntimeProtocol {
    static final String WORKER="dev.vantara.runtime.worker.v1", BROKER="dev.vantara.runtime.broker.v1";
    static final int HELLO=IBinder.FIRST_CALL_TRANSACTION, LOAD=HELLO+1, INVOKE=HELLO+2, CLOSE=HELLO+3,LOAD_CLOUDSTREAM=HELLO+4;
    static final int MAX_TEXT=65536, MAX_DEX=8*1024*1024;
    static final int HTTP_EXCHANGE=HELLO+1, MAX_REQUEST=1024*1024, MAX_RESPONSE=4*1024*1024;
    static final Set<String> OPERATIONS=Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "catalogue","search","details","episodes","chapters","pages","videoLinks","capabilities")));
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
    static void writeHeaders(Parcel parcel,Map<String,List<String>> headers) {
        if(headers.size()>64)throw new RuntimeFailure("HEADER_LIMIT");parcel.writeInt(headers.size());int bytes=0;
        for(Map.Entry<String,List<String>> row:headers.entrySet()) {
            bytes+=row.getKey().length();if(row.getValue().size()>32)throw new RuntimeFailure("HEADER_LIMIT");
            parcel.writeString(row.getKey());parcel.writeInt(row.getValue().size());
            for(String value:row.getValue()){bytes+=value.length();if(bytes>32768)throw new RuntimeFailure("HEADER_LIMIT");parcel.writeString(value);}
        }
    }
    static Map<String,List<String>> readHeaders(Parcel parcel) {
        int count=parcel.readInt(),size=0;if(count<0||count>64)throw new RuntimeFailure("HEADER_LIMIT");Map<String,List<String>> headers=new LinkedHashMap<>();
        for(int i=0;i<count;i++){
            String name=parcel.readString();int n=parcel.readInt();if(name==null||name.length()>8192||n<0||n>32)throw new RuntimeFailure("HEADER_LIMIT");size+=name.length();List<String> values=new ArrayList<>();
            for(int j=0;j<n;j++){String value=parcel.readString();if(value==null)throw new RuntimeFailure("HEADER_LIMIT");size+=value.length();if(size>32768)throw new RuntimeFailure("HEADER_LIMIT");values.add(value);}
            if(headers.put(name,values)!=null)throw new RuntimeFailure("HEADER_LIMIT");
        }
        return headers;
    }
    /** Only small bodies are inline. Pipes keep the Binder transaction below its shared budget. */
    static void writeBytes(Parcel parcel,byte[] bytes,int maximum) throws IOException {
        writeBytes(parcel,bytes,maximum,()->false);
    }
    static void writeBytes(Parcel parcel,byte[] bytes,int maximum,BooleanSupplier closed) throws IOException {
        if(bytes==null){parcel.writeInt(-1);return;}
        if(bytes.length>maximum)throw new RuntimeFailure("PAYLOAD_LIMIT");
        parcel.writeInt(bytes.length);boolean pipe=bytes.length>8192;parcel.writeInt(pipe?1:0);
        if(!pipe){parcel.writeByteArray(bytes);return;}
        RuntimePipes.write(parcel,bytes,closed);
    }
    static byte[] readBytes(Parcel parcel,int maximum) throws IOException {
        return readBytes(parcel,maximum,()->false);
    }
    static byte[] readBytes(Parcel parcel,int maximum,BooleanSupplier closed) throws IOException {
        int expected=parcel.readInt();if(expected==-1){if(parcel.dataAvail()!=0)throw new RuntimeFailure("IPC_CONTRACT");return null;}if(expected<0||expected>maximum)throw new RuntimeFailure("PAYLOAD_LIMIT");
        int framed=parcel.readInt();if(framed==0){byte[] inline=parcel.createByteArray();if(inline==null||inline.length!=expected||parcel.dataAvail()!=0)throw new RuntimeFailure("IPC_CONTRACT");return inline;}
        if(framed!=1)throw new RuntimeFailure("IPC_CONTRACT");
        ParcelFileDescriptor fd=parcel.readTypedObject(ParcelFileDescriptor.CREATOR);if(fd==null)throw new RuntimeFailure("IPC_CONTRACT");
        if(parcel.dataAvail()!=0){fd.close();throw new RuntimeFailure("IPC_CONTRACT");}
        return RuntimePipes.read(fd,expected,closed);
    }
    static void writeRequest(Parcel parcel,RuntimeHttpAccess.Request request) throws IOException {
        parcel.writeString(text(request.url()));parcel.writeString(text(request.method()));writeHeaders(parcel,request.headers());parcel.writeInt(request.followRedirects()?1:0);writeBytes(parcel,request.body(),MAX_REQUEST);
    }
    static RuntimeHttpAccess.Request readRequest(Parcel parcel) throws IOException {
        return readRequest(parcel,()->false);
    }
    static RuntimeHttpAccess.Request readRequest(Parcel parcel,BooleanSupplier closed) throws IOException {
        String url=text(parcel.readString()),method=text(parcel.readString());Map<String,List<String>> headers=readHeaders(parcel);int follow=parcel.readInt();if(follow!=0&&follow!=1)throw new RuntimeFailure("IPC_CONTRACT");return new RuntimeHttpAccess.Request(url,method,headers,readBytes(parcel,MAX_REQUEST,closed),follow==1);
    }
    static void writeHttpResponse(Parcel parcel,RuntimeHttpAccess.Response response) throws IOException {
        writeHttpResponse(parcel,response,()->false);
    }
    static void writeHttpResponse(Parcel parcel,RuntimeHttpAccess.Response response,BooleanSupplier closed) throws IOException {
        parcel.writeString(text(response.url()));parcel.writeInt(response.status());writeHeaders(parcel,response.headers());writeBytes(parcel,response.body(),MAX_RESPONSE,closed);
    }
    static RuntimeHttpAccess.Response readHttpResponse(Parcel parcel) throws IOException {
        String url=text(parcel.readString());int status=parcel.readInt();Map<String,List<String>> headers=readHeaders(parcel);byte[] body=readBytes(parcel,MAX_RESPONSE);
        if(status<100||status>599||body==null)throw new RuntimeFailure("IPC_CONTRACT");return new RuntimeHttpAccess.Response(url,status,headers,body);
    }
    private RuntimeProtocol() {}
}
