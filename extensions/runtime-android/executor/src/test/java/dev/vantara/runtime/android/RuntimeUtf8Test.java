package dev.vantara.runtime.android;

import java.nio.charset.StandardCharsets;
import org.junit.Test;
import static org.junit.Assert.*;

public class RuntimeUtf8Test {
    @Test public void exactByteBoundaryPreservesAsciiArabicCjkAndSurrogatePairs() {
        for(String value:new String[]{"ascii","مرحبا","中文","\ud83d\ude00","a\ud83dX\ude00z"}) {
            byte[] expected=value.getBytes(StandardCharsets.UTF_8);
            assertArrayEquals(expected,RuntimeUtf8.encodeBounded(value,expected.length));
            try {RuntimeUtf8.encodeBounded(value,expected.length-1);fail("Oversized UTF8 accepted");}
            catch(RuntimeFailure failure){assertEquals("PAYLOAD_LIMIT",failure.code);}
        }
    }
    @Test public void oversizedNativeRegressionIsRejectedBeforeEncodingItsLargeBuffer() {
        char[] large=new char[1500000];java.util.Arrays.fill(large,'中');
        try {RuntimeUtf8.encodeBounded(new String(large),4*1024*1024);fail("Multibyte budget bypassed");}
        catch(RuntimeFailure failure){assertEquals("PAYLOAD_LIMIT",failure.code);}
    }
}
