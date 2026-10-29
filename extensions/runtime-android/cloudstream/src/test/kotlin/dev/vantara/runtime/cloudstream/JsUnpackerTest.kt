package dev.vantara.runtime.cloudstream

import com.lagradost.cloudstream3.utils.JsUnpacker
import org.junit.Assert.*
import org.junit.Test

class JsUnpackerTest {
    // Same shape video hosts emit: tokens are base-N indexes into the dictionary; empty entries keep the token.
    private val packed="""eval(function(p,a,c,k,e,d){e=function(c){return c};if(!''.replace(/^/,String)){while(c--){d[c]=k[c]||c}k=[function(e){return d[e]}];e=function(){return'\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('0 1={2:"3://4.5/6.7"};',8,8,'var|player|file|https|cdn|example|master|m3u8'.split('|'),0,{}))"""
    @Test fun unpacksTheDictionaryEncodedPlayerConfig() {
        val unpacker=JsUnpacker(packed)
        assertTrue(unpacker.detect())
        assertEquals("""var player={file:"https://cdn.example/master.m3u8"};""",unpacker.unpack())
    }
    @Test fun plainScriptsAndMismatchedDictionariesAreLeftAlone() {
        assertFalse(JsUnpacker("var a=1;").detect())
        assertNull(JsUnpacker("var a=1;").unpack())
        assertNull(JsUnpacker("""}('0 1',8,3,'a|b'.split('|'),0,{}))""").unpack())
        assertNull(JsUnpacker(null).unpack())
    }
}
