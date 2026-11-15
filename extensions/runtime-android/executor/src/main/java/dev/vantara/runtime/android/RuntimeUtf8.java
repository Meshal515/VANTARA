package dev.vantara.runtime.android;

import java.nio.charset.StandardCharsets;

/** Reject an oversized UTF-8 result before CharsetUtils allocates its full buffer. */
final class RuntimeUtf8 {
    static byte[] encodeBounded(String text,int maximum) {
        if(text==null || text.length()>maximum)throw new RuntimeFailure("PAYLOAD_LIMIT");
        int size=0;
        for(int i=0;i<text.length();i++) {
            char c=text.charAt(i);
            if(c<0x80)size++;
            else if(c<0x800)size+=2;
            else if(Character.isHighSurrogate(c) && i+1<text.length() && Character.isLowSurrogate(text.charAt(i+1))) {size+=4;i++;}
            else if(Character.isSurrogate(c))size++; // String.getBytes replaces an unpaired surrogate with '?'.
            else size+=3;
            if(size>maximum)throw new RuntimeFailure("PAYLOAD_LIMIT");
        }
        return text.getBytes(StandardCharsets.UTF_8);
    }
    private RuntimeUtf8() {}
}
