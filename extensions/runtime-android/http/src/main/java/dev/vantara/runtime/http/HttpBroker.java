package dev.vantara.runtime.http;

import okhttp3.*;
import java.io.*;
import java.net.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Original host-owned HTTP broker. No UI, player, provider code or automatic retries. */
public final class HttpBroker {
    public static final int MAX_REQUEST_BYTES=1024*1024, MAX_RESPONSE_BYTES=4*1024*1024;
    public record Scope(String family,String packageId,String sourceId,String sessionId,Set<String> origins) {
        public Scope {
            for(String value:Arrays.asList(family,packageId,sourceId,sessionId))
                if(value==null||value.isEmpty()||value.length()>200)throw new IllegalArgumentException("Invalid broker identity");
            if(origins==null||origins.isEmpty()||origins.size()>32)throw new IllegalArgumentException("Invalid broker origins");
            Set<String> normalized=new HashSet<>();
            for(String value:origins)normalized.add(origin(checkedUrl(value)));
            origins=Collections.unmodifiableSet(normalized);
        }
    }
    public record Input(String url,String method,Headers headers,byte[] body,boolean followRedirects) {
        public Input {headers=headers==null?new Headers.Builder().build():headers;body=body==null?null:body.clone();}
        @Override public byte[] body(){return body==null?null:body.clone();}
    }
    public record Output(String url,int status,Headers headers,byte[] body) {
        public Output {body=body.clone();}
        @Override public byte[] body(){return body.clone();}
    }
    public static final class Failure extends IOException {
        public final String code; public final long retryAt;
        public Failure(String code){this(code,0);}
        public Failure(String code,long retryAt){super(code);this.code=code;this.retryAt=retryAt;}
    }
    public interface CookieVault {List<Cookie> load(HttpUrl url);void save(HttpUrl url,List<Cookie> cookies);}
    public interface Vaults {CookieVault forScope(Scope scope);}
    public interface AddressPermission {boolean allows(InetAddress address);}
    private record Challenge(String family,String pkg,String source,String session,String origin) {}
    private static final class Host {int active;long retryAt;}
    private final OkHttpClient client;
    private final Vaults vaults;
    private final Clock clock;
    private final LinkedHashMap<String,Host> hosts=new LinkedHashMap<>();
    private final Set<Challenge> challenges=new HashSet<>();
    private final Semaphore total=new Semaphore(4);

    public HttpBroker(OkHttpClient base,Dns resolver,AddressPermission addresses,Vaults vaults,Clock clock) {
        this.vaults=Objects.requireNonNull(vaults);this.clock=Objects.requireNonNull(clock);
        Objects.requireNonNull(resolver);Objects.requireNonNull(addresses);
        Dns checked=hostname->{
            final List<InetAddress> resolved;
            try{resolved=resolver.lookup(hostname);}catch(UnknownHostException e){throw new DeniedDns("DNS_FAILED");}
            if(resolved==null||resolved.isEmpty()||resolved.size()>32)throw new DeniedDns("DNS_FAILED");
            for(InetAddress address:resolved)if(address==null||!addresses.allows(address))throw new DeniedDns("DNS_ADDRESS_DENIED");
            return new ArrayList<>(resolved);
        };
        // DNS is checked by the connection's actual resolver, not by a separate
        // preflight lookup that could rebind before connect. Proxies/retries and
        // automatic redirects must not sidestep this broker's hop admission.
        OkHttpClient.Builder isolated=Objects.requireNonNull(base).newBuilder().dns(checked).proxy(Proxy.NO_PROXY).cache(null)
            .cookieJar(CookieJar.NO_COOKIES).authenticator(okhttp3.Authenticator.NONE).proxyAuthenticator(okhttp3.Authenticator.NONE)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .connectTimeout(10,TimeUnit.SECONDS).readTimeout(15,TimeUnit.SECONDS).callTimeout(20,TimeUnit.SECONDS);
        isolated.interceptors().clear();isolated.networkInterceptors().clear();
        client=isolated.build();
    }
    public Session open(Scope scope) {return new Session(Objects.requireNonNull(scope),Objects.requireNonNull(vaults.forScope(scope)));}
    private static HttpUrl checkedUrl(String value) {
        if(value==null||value.length()>8192||value.matches("(?s).*[\\x00-\\x20\\x7f].*"))throw new IllegalArgumentException("INVALID_ENDPOINT");
        final HttpUrl parsed;
        try{parsed=HttpUrl.get(value);}catch(IllegalArgumentException e){throw new IllegalArgumentException("INVALID_ENDPOINT");}
        if(!parsed.isHttps()||!parsed.username().isEmpty()||!parsed.password().isEmpty())throw new IllegalArgumentException("INVALID_ENDPOINT");
        return parsed.newBuilder().fragment(null).build();
    }
    public static String origin(HttpUrl url){return url.scheme()+"://"+(url.host().contains(":")?"["+url.host()+"]":url.host())+(url.port()==443?"":":"+url.port());}
    private Challenge challenge(Scope s,String origin){return new Challenge(s.family(),s.packageId(),s.sourceId(),s.sessionId(),origin);}
    /** Host verification coordinator only; this controller is never given to provider code. */
    public void verificationSucceeded(Scope s,String origin) {synchronized(challenges){challenges.remove(challenge(s,origin));}}
    private Host acquireHost(String name) throws Failure {
        synchronized(hosts){
            Host state=hosts.get(name);
            if(state==null){
                if(hosts.size()>=128){
                    Iterator<Map.Entry<String,Host>> rows=hosts.entrySet().iterator();boolean evicted=false;
                    while(rows.hasNext()){Host old=rows.next().getValue();if(old.active==0&&old.retryAt<=clock.millis()){rows.remove();evicted=true;break;}}
                    if(!evicted)throw new Failure("ENGINE_CAPACITY");
                }
                state=new Host();hosts.put(name,state);
            }
            if(state.active!=0)throw new Failure("HOST_BUSY");
            if(state.retryAt>clock.millis())throw new Failure("HOST_COOLDOWN",state.retryAt);
            state.active++;return state;
        }
    }
    private void release(Host host){synchronized(hosts){host.active--;}}
    private void cooldown(Host host,long delay){synchronized(hosts){host.retryAt=Math.max(host.retryAt,saturatingAdd(clock.millis(),delay));}}
    private static long saturatingAdd(long a,long b){return b>Long.MAX_VALUE-a?Long.MAX_VALUE:a+b;}
    private long retryAfter(Response response){
        String value=response.header("Retry-After");if(value==null)return 60000;
        try{if(value.trim().matches("[0-9]+")){long seconds=Long.parseLong(value.trim());return seconds>Long.MAX_VALUE/1000?Long.MAX_VALUE:seconds*1000;}}
        catch(NumberFormatException e){return Long.MAX_VALUE;}
        try{
            long target=ZonedDateTime.parse(value,DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli();
            long now=clock.millis();String date=response.header("Date");
            if(date!=null)try{now=ZonedDateTime.parse(date,DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli();}catch(RuntimeException ignored){}
            return Math.max(0,target-now);
        }catch(RuntimeException e){return 60000;}
    }
    private static final class DeniedDns extends UnknownHostException {final String code;DeniedDns(String code){super(code);this.code=code;}}

    public final class Session implements AutoCloseable {
        private final Scope scope;
        private final CookieVault cookies;
        private final AtomicBoolean closed=new AtomicBoolean();
        private final Set<Call> active=new HashSet<>();
        private Session(Scope scope,CookieVault cookies){this.scope=scope;this.cookies=cookies;}
        public boolean needsVerification(String origin){synchronized(challenges){return challenges.contains(challenge(scope,origin));}}
        private void admit(HttpUrl url) throws Failure {
            if(closed.get())throw new Failure("SESSION_CLOSED");
            if(!scope.origins().contains(origin(url)))throw new Failure("ORIGIN_NOT_ALLOWED");
            if(needsVerification(origin(url)))throw new Failure("VERIFICATION_REQUIRED");
        }
        public Output execute(Input input) throws IOException {
            if(closed.get())throw new Failure("SESSION_CLOSED");
            if(input==null)throw new Failure("INVALID_REQUEST");
            HttpUrl url;try{url=checkedUrl(input.url());}catch(IllegalArgumentException e){throw new Failure("INVALID_ENDPOINT");}
            String method=input.method();if(!Arrays.asList("GET","HEAD","POST","PUT").contains(method))throw new Failure("METHOD_UNSUPPORTED");
            byte[] body=input.body();if(body!=null&&body.length>MAX_REQUEST_BYTES)throw new Failure("REQUEST_BODY_LIMIT");
            if((method.equals("GET")||method.equals("HEAD"))&&body!=null)throw new Failure("INVALID_REQUEST_BODY");
            Headers headers=input.headers();
            for(String name:headers.names())if(Arrays.asList("host","connection","content-length","transfer-encoding","proxy-authorization").contains(name.toLowerCase(Locale.ROOT)))throw new Failure("REQUEST_HEADER_FORBIDDEN");
            if(!total.tryAcquire())throw new Failure("ENGINE_BUSY");
            try {
                for(int hop=0;hop<=5;hop++) {
                    admit(url);Host host=acquireHost(url.host());
                    try {
                        // Let the transport negotiate/decode gzip. Provider headers must
                        // not disable OkHttp's bounded, transparent decompression.
                        Headers.Builder sent=headers.newBuilder().removeAll("Accept-Encoding");List<Cookie> jar=cookies.load(url);
                        if(headers.get("Cookie")==null&&!jar.isEmpty()){
                            StringBuilder cookie=new StringBuilder();for(Cookie c:jar){if(cookie.length()>0)cookie.append("; ");cookie.append(c.name()).append('=').append(c.value());}sent.set("Cookie",cookie.toString());
                        }
                        RequestBody payload=(method.equals("POST")||method.equals("PUT"))?RequestBody.create(body==null?new byte[0]:body,MediaType.parse(headers.get("Content-Type")==null?"application/octet-stream":headers.get("Content-Type"))):null;
                        Request request=new Request.Builder().url(url).headers(sent.build()).method(method,payload).build();
                        Call call=client.newCall(request);
                        synchronized(active){if(closed.get())throw new Failure("SESSION_CLOSED");active.add(call);}
                        try(Response response=call.execute()) {
                            if(closed.get())throw new Failure("SESSION_CLOSED");
                            cookies.save(url,Cookie.parseAll(url,response.headers()));
                            if("challenge".equalsIgnoreCase(response.header("cf-mitigated"))){
                                synchronized(challenges){if(challenges.size()>=128&&!challenges.contains(challenge(scope,origin(url))))throw new Failure("ENGINE_CAPACITY");challenges.add(challenge(scope,origin(url)));}
                                throw new Failure("VERIFICATION_REQUIRED");
                            }
                            if(response.code()==429){cooldown(host,retryAfter(response));throw new Failure("RATE_LIMITED",host.retryAt);}
                            if(response.code()==403){cooldown(host,30000);throw new Failure("ACCESS_DENIED");}
                            if(response.code()>=500){cooldown(host,5000);throw new Failure("HTTP_SERVER_ERROR");}
                            String location=response.header("Location");int status=response.code();
                            if(input.followRedirects()&&location!=null&&Arrays.asList(301,302,303,307,308).contains(status)) {
                                if(hop==5)throw new Failure("REDIRECT_LIMIT");
                                HttpUrl next=url.resolve(location);if(next==null||!next.isHttps()||!next.username().isEmpty()||!next.password().isEmpty())throw new Failure("INVALID_REDIRECT");
                                admit(next);
                                Headers.Builder nextHeaders=headers.newBuilder();
                                if(!origin(url).equals(origin(next))) {
                                    for(String sensitive:Arrays.asList("Authorization","Cookie","Origin","Proxy-Authorization"))nextHeaders.removeAll(sensitive);
                                    if(headers.get("Referer")!=null)nextHeaders.set("Referer",origin(url)+"/");
                                }
                                if((status==303&&!method.equals("HEAD"))||((status==301||status==302)&&method.equals("POST"))){method="GET";body=null;nextHeaders.removeAll("Content-Type");}
                                headers=nextHeaders.build();url=next;continue;
                            }
                            String encoding=response.header("Content-Encoding");
                            if(encoding!=null&&!"identity".equalsIgnoreCase(encoding))throw new Failure("UNSUPPORTED_CONTENT_ENCODING");
                            ByteArrayOutputStream bytes=new ByteArrayOutputStream();ResponseBody stream=response.body();
                            if(stream!=null) {
                                if(stream.contentLength()>MAX_RESPONSE_BYTES)throw new Failure("RESPONSE_BODY_LIMIT");
                                try(InputStream in=stream.byteStream()) {byte[] chunk=new byte[8192];int n;while((n=in.read(chunk))!=-1){if(bytes.size()+n>MAX_RESPONSE_BYTES)throw new Failure("RESPONSE_BODY_LIMIT");bytes.write(chunk,0,n);}}
                            }
                            if(closed.get())throw new Failure("SESSION_CLOSED");
                            return new Output(url.toString(),status,response.headers(),bytes.toByteArray());
                        } catch(IOException e) {
                            if(closed.get())throw new Failure("SESSION_CLOSED");
                            if(e instanceof Failure)throw e;
                            for(Throwable cause=e;cause!=null;cause=cause.getCause())if(cause instanceof DeniedDns)throw new Failure(((DeniedDns)cause).code);
                            Failure failure=new Failure("TRANSPORT_FAILED");failure.initCause(e);throw failure;
                        } finally {synchronized(active){active.remove(call);}}
                    } finally {release(host);}
                }
                throw new Failure("REDIRECT_LIMIT");
            } finally {total.release();}
        }
        @Override public void close(){if(closed.compareAndSet(false,true))synchronized(active){for(Call call:active)call.cancel();}}
    }
}
