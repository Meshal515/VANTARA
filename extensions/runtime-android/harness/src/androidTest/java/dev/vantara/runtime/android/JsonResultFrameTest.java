package dev.vantara.runtime.android;

import android.os.Parcel;
import org.junit.Test;
import java.util.Arrays;
import static org.junit.Assert.*;

public class JsonResultFrameTest {
    @Test public void invalidUtf8CannotBecomeSuccessfulReplacementText()throws Exception{
        Parcel frame=Parcel.obtain();
        try{
            frame.writeNoException();frame.writeString("OK");RuntimeProtocol.writeBytes(frame,new byte[]{(byte)0xc3,0x28},RuntimeProtocol.MAX_RESPONSE);frame.setDataPosition(0);
            try{RuntimeProtocol.jsonResponse(frame,()->false);fail("Malformed UTF8 accepted");}catch(RuntimeFailure expected){assertEquals("IPC_CONTRACT",expected.code);}
        }finally{frame.recycle();}
    }
    @Test public void byteLimitStillAppliesToMultibyteText()throws Exception{
        char[] large=new char[1500000];Arrays.fill(large,'中');Parcel frame=Parcel.obtain();
        try{try{RuntimeProtocol.jsonResult(frame,new String(large));fail("UTF8 byte budget bypassed");}catch(RuntimeFailure expected){assertEquals("PAYLOAD_LIMIT",expected.code);}}
        finally{frame.recycle();}
    }
    @Test public void resultFrameCannotSmuggleTrailingPayload()throws Exception{
        Parcel frame=Parcel.obtain();
        try{
            RuntimeProtocol.jsonResult(frame,"{}");frame.writeInt(17);frame.setDataPosition(0);
            try{RuntimeProtocol.jsonResponse(frame,()->false);fail("Trailing result data accepted");}catch(RuntimeFailure expected){assertEquals("IPC_CONTRACT",expected.code);}
        }finally{frame.recycle();}
    }
}
