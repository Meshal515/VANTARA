package dev.vantara.runtime.http;
import org.junit.Test;
import static org.junit.Assert.*;
import java.net.*;
public class PublicAddressesTest {
    private final PublicAddresses policy=new PublicAddresses();
    @Test public void privateAndSpecialRangesAreDenied() throws Exception {
        for(String ip:new String[]{"127.0.0.1","10.0.0.1","172.16.0.1","192.168.1.1","169.254.169.254","100.64.0.1","0.0.0.0","224.0.0.1","::1","fc00::1","fe80::1","ff00::1","2001:db8::1"})assertFalse(ip,policy.allows(InetAddress.getByName(ip)));
        assertTrue(policy.allows(InetAddress.getByName("8.8.8.8")));assertTrue(policy.allows(InetAddress.getByName("2606:4700:4700::1111")));
    }
    @Test public void mappedIpv4CannotHidePrivateAddress() throws Exception {
        byte[] bytes=new byte[16];bytes[10]=(byte)255;bytes[11]=(byte)255;bytes[12]=127;bytes[15]=1;
        assertFalse(policy.allows(Inet6Address.getByAddress(null,bytes,-1)));
        bytes[12]=8;bytes[13]=8;bytes[14]=8;bytes[15]=8;assertTrue(policy.allows(Inet6Address.getByAddress(null,bytes,-1)));
    }
    @Test public void wellKnownNat64KeepsPublicIpv4AndDeniesPrivateIpv4() throws Exception {
        assertFalse(policy.allows(InetAddress.getByName("64:ff9b::127.0.0.1")));
        assertTrue(policy.allows(InetAddress.getByName("64:ff9b::8.8.8.8")));
        assertFalse(policy.allows(InetAddress.getByName("64:ff9b:1::192.168.0.1")));
    }
}
