package dev.vantara.runtime.android;

import static org.junit.Assert.assertEquals;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import org.junit.Test;

/** انحدار: AnimeWitcher كان يعرض PROVIDER_FAILED لكل عطل فلا يُعرف المسؤول. */
public class FailureCodesTest {
    private static <T extends Throwable> T thrownBy(T e,String type) {
        e.setStackTrace(new StackTraceElement[]{new StackTraceElement(type,"f",null,1)});return e;
    }

    @Test public void siteAndNetwork() {
        assertEquals("SITE_DNS",FailureCodes.of(new UnknownHostException("x")));
        assertEquals("OPERATION_TIMEOUT",FailureCodes.of(new SocketTimeoutException()));
        assertEquals("SITE_NETWORK",FailureCodes.of(new RuntimeException(new IOException("reset"))));
    }

    @Test public void engineCodesPassButSourceMessagesDoNot() {
        assertEquals("NO_VIDEO_LINKS",FailureCodes.of(thrownBy(new IOException("NO_VIDEO_LINKS"),"dev.vantara.runtime.cloudstream.CloudStreamProvider")));
        // رسالة بشكل رمز من كود الإضافة لا تعبر: قد تحمل أي شيء
        assertEquals("SITE_NETWORK",FailureCodes.of(thrownBy(new IOException("SECRET_TOKEN_ABC"),"com.example.provider.Witcher")));
        assertEquals("ABI_MISMATCH",FailureCodes.of(new RuntimeException(new RuntimeFailure("ABI_MISMATCH"))));
    }

    @Test public void parserCrashIsExtension() {
        assertEquals("EXTENSION_PARSE",FailureCodes.of(new NullPointerException()));
        assertEquals("EXTENSION_PARSE",FailureCodes.of(new NumberFormatException("x")));
    }

    @Test public void unsupported() {
        assertEquals("CAPABILITY_UNSUPPORTED",FailureCodes.of(new UnsupportedOperationException("x")));
    }

    @Test public void unknownStaysGeneric() {
        assertEquals("PROVIDER_FAILED",FailureCodes.of(new Exception("boom")));
    }
}
