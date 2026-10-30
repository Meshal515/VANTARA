package dev.vantara.runtime.android;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.ConnectException;
import java.net.UnknownHostException;
import java.util.regex.Pattern;
import javax.net.ssl.SSLException;

/**
 * يحوّل عطل الإضافة إلى رمز ثابت بدل PROVIDER_FAILED الواحد لكل شيء، فيُعرف هل العطل من الموقع
 * أو الشبكة أو كود الإضافة أو وظيفة غير مدعومة. يقرأ نوع الاستثناء فقط، ولا يعبر رسالة المصدر
 * الحدود أبدًا إلا إن كانت رمزًا من رموز المحرك نفسه (NO_VIDEO_LINKS…).
 */
final class FailureCodes {
    private static final Pattern CODE=Pattern.compile("[A-Z][A-Z0-9_]{2,60}");
    private FailureCodes() {}

    static String of(Throwable failure) {
        int depth=0;
        for(Throwable e=failure;e!=null&&depth<6;e=e.getCause(),depth++) {
            if(e instanceof RuntimeFailure) return ((RuntimeFailure)e).code;
            String own=ownCode(e);
            if(own!=null) return own;
        }
        depth=0;
        for(Throwable e=failure;e!=null&&depth<6;e=e.getCause(),depth++) {
            String type=e.getClass().getName();
            if(type.startsWith("com.fasterxml.jackson")||type.startsWith("org.jsoup")||type.startsWith("kotlinx.serialization")||type.startsWith("org.json"))
                return "EXTENSION_PARSE";
            if(type.equals("kotlinx.coroutines.TimeoutCancellationException")||e instanceof InterruptedIOException) return "OPERATION_TIMEOUT";
            if(e instanceof UnknownHostException) return "SITE_DNS";
            if(e instanceof SSLException) return "SITE_TLS";
            if(e instanceof ConnectException) return "SITE_UNREACHABLE";
            if(e instanceof UnsupportedOperationException) return "CAPABILITY_UNSUPPORTED";
            if(e instanceof IOException) return "SITE_NETWORK";
        }
        // check/require العامة تبقى PROVIDER_FAILED (عطل في الإضافة دون تفصيل). كود الإضافة رمى أثناء قراءة صفحة الموقع (عنصر مفقود، رقم غير صالح…): الموقع تغيّر أو الإضافة معيبة
        if(failure instanceof NullPointerException||failure instanceof IndexOutOfBoundsException||failure instanceof java.util.NoSuchElementException
            ||failure instanceof NumberFormatException||failure instanceof ClassCastException
            ||failure.getClass().getName().equals("kotlin.UninitializedPropertyAccessException"))
            return "EXTENSION_PARSE";
        return "PROVIDER_FAILED";
    }

    /** رمز رماه المحرك أو طبقة CloudStream المضمّنة فيه، لا الإضافة. */
    private static String ownCode(Throwable e) {
        String message=e.getMessage();
        if(message==null||!CODE.matcher(message).matches()) return null;
        StackTraceElement[] trace=e.getStackTrace();
        if(trace.length==0) return null;
        String origin=trace[0].getClassName();
        return origin.startsWith("dev.vantara.")||origin.startsWith("com.lagradost.") ? message : null;
    }
}
