package dev.vantara.runtime.android;

import dev.vantara.runtime.api.RuntimeHttpAccess;
import java.util.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class HttpHeaderSemanticsTest {
    @Test public void responseLookupIsCaseInsensitiveAsRequiredByHttp(){
        RuntimeHttpAccess.Response response=new RuntimeHttpAccess.Response("https://fixtures.example",200,Collections.singletonMap("x-result",Arrays.asList("kept")),new byte[0]);
        assertEquals(Arrays.asList("kept"),response.headers().get("X-Result"));
    }
    @Test public void repeatedMixedCaseNamesPreserveAllValuesAndRemainImmutable(){
        Map<String,List<String>> headers=new LinkedHashMap<>();headers.put("Set-Cookie",new ArrayList<>(Arrays.asList("a=1")));headers.put("set-cookie",new ArrayList<>(Arrays.asList("b=2")));
        RuntimeHttpAccess.Response response=new RuntimeHttpAccess.Response("https://fixtures.example",200,headers,new byte[0]);
        headers.get("Set-Cookie").clear();
        assertEquals(1,response.headers().size());assertEquals(Arrays.asList("a=1","b=2"),response.headers().get("SET-COOKIE"));
        try{response.headers().get("set-cookie").clear();fail("Mutable response headers");}catch(UnsupportedOperationException expected){}
    }
}
