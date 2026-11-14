package dev.vantara.runtime.fixtures;

import dev.vantara.runtime.api.*;
import java.util.*;

public final class HttpProvider implements RuntimeProvider {
    public void initialize(RuntimeAccess access){}
    public String invoke(String operation,String input,RuntimeAccess access) throws Exception {
        byte[] body=new byte[160*1024];Arrays.fill(body,(byte)17);
        RuntimeHttpAccess.Response result=((RuntimeHttpAccess)access).exchange(new RuntimeHttpAccess.Request("https://fixtures.example/post","POST",Collections.singletonMap("X-Fixture",Arrays.asList("real")),body,false));
        return result.status()+":"+result.body().length+":"+result.body()[result.body().length-1]+":"+result.headers().get("X-Result").get(0)+":"+result.url();
    }
}
