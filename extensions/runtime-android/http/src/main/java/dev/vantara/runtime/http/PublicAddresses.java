package dev.vantara.runtime.http;
import java.net.*;
import java.util.Arrays;

/** Default outbound address policy; local-network access requires host-owned explicit permission. */
public final class PublicAddresses implements HttpBroker.AddressPermission {
    public boolean allows(InetAddress address) {
        if(address.isAnyLocalAddress()||address.isLoopbackAddress()||address.isLinkLocalAddress()||address.isSiteLocalAddress()||address.isMulticastAddress())return false;
        byte[] raw=address.getAddress();
        if(raw.length==4){
            int a=raw[0]&255,b=raw[1]&255,c=raw[2]&255;
            return !(a==0||a==10||a==127||a>=224||(a==100&&b>=64&&b<=127)||(a==169&&b==254)||(a==172&&b>=16&&b<=31)||(a==192&&(b==168||b==0||(b==2)))||(a==198&&(b==18||b==19||(b==51&&c==100)))||(a==203&&b==0&&c==113));
        }
        if(raw.length!=16)return false;
        int a=raw[0]&255,b=raw[1]&255;
        boolean mapped=true;for(int i=0;i<10;i++)if(raw[i]!=0)mapped=false;
        mapped=mapped&&(raw[10]&255)==255&&(raw[11]&255)==255;
        boolean nat64=a==0&&b==100&&(raw[2]&255)==255&&(raw[3]&255)==155;
        if(nat64&&(raw[4]!=0||raw[5]!=0))return false;
        if(nat64)for(int i=4;i<12;i++)if(raw[i]!=0)return false;
        if(mapped||nat64)try{return allows(InetAddress.getByAddress(Arrays.copyOfRange(raw,12,16)));}catch(UnknownHostException impossible){return false;}
        if((a&254)==252||(a==254&&(b&192)==128)||a==255)return false;
        boolean zero=true;for(int i=0;i<12;i++)if(raw[i]!=0)zero=false;
        if(zero)return false;
        if(a==32&&b==2)return false; // 6to4 embeds another address; no implicit private routing.
        if(a==32&&b==1&&((raw[2]==0&&raw[3]==0)||((raw[2]&255)==13&&(raw[3]&255)==184)))return false;
        return true;
    }
}
