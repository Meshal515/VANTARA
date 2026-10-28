package dev.vantara.runtime.api;

import java.util.*;

/** Optional full-HTTP capability. No host context, cookie store or identity setters cross this boundary. */
public interface RuntimeHttpAccess extends RuntimeAccess {
    final class Request {
        private final String url,method;private final Map<String,List<String>> headers;private final byte[] body;private final boolean followRedirects;
        public Request(String url,String method,Map<String,List<String>> headers,byte[] body,boolean followRedirects){this.url=url;this.method=method;this.headers=copyHeaders(headers);this.body=body==null?null:body.clone();this.followRedirects=followRedirects;}
        public String url(){return url;}public String method(){return method;}public Map<String,List<String>> headers(){return headers;}
        public byte[] body(){return body==null?null:body.clone();}public boolean followRedirects(){return followRedirects;}
    }
    final class Response {
        private final String url;private final int status;private final Map<String,List<String>> headers;private final byte[] body;
        public Response(String url,int status,Map<String,List<String>> headers,byte[] body){this.url=url;this.status=status;this.headers=copyHeaders(headers);this.body=Objects.requireNonNull(body).clone();}
        public String url(){return url;}public int status(){return status;}public Map<String,List<String>> headers(){return headers;}public byte[] body(){return body.clone();}
    }
    static Map<String,List<String>> copyHeaders(Map<String,List<String>> headers) {
        Objects.requireNonNull(headers);Map<String,List<String>> result=new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        headers.forEach((key,values)->{
            Objects.requireNonNull(key);List<String> combined=new ArrayList<>(result.getOrDefault(key,Collections.emptyList()));
            combined.addAll(values);result.put(key,Collections.unmodifiableList(combined));
        });
        return Collections.unmodifiableMap(result);
    }
    Response exchange(Request request) throws Exception;
}
