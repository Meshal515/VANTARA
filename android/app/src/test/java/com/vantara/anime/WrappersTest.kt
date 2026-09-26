package com.vantara.anime

import com.vantara.anime.hosts.Videa
import com.vantara.anime.hosts.Yonaplay
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** قارئا videa وyonaplay، بعينات من ردود حقيقية (WitAnime، Frieren 14). */
class WrappersTest {

    private val xml = """<?xml version="1.0" encoding="UTF-8" ?>
<videa_video>
  <video_sources cache_id="" exp="1790420133">
    <video_source name="240p" mimetype="video/mp4" codecs="avc1.640015, mp4a.40.2" width="426" height="240" exp="1790420133">//videa.hu/static/240p/8.2557725.2306131.1.0.1.1</video_source>
    <video_source name="1080p" mimetype="video/webm" codecs="vp9, opus" width="1920" height="1080" exp="1790420133">//videa.hu/static/w1080p/8.2557725.2306131.1.0.1.1</video_source>
  </video_sources>
  <hash_values>
    <hash_value_240p>sKsbXFdbXgoCqOxd4gUaEw</hash_value_240p>
    <hash_value_1080p>DL5h-RpcGlxP3Qyskc2skw</hash_value_1080p>
  </hash_values>
</videa_video>"""

    @Test fun `videa sources are signed and highest first`() {
        val list = Videa.sources(xml)
        assertEquals(listOf(1080, 240), list.map { it.height })
        assertEquals("https://videa.hu/static/w1080p/8.2557725.2306131.1.0.1.1?md5=DL5h-RpcGlxP3Qyskc2skw&expires=1790420133", list[0].url)
        val streams = Videa.toStreams(list, "https://videa.hu/player?v=x", "UA")
        assertEquals("https://videa.hu/player?v=x", streams[0].headers["Referer"])
    }

    @Test fun `videa rc4 is its own inverse`() {
        val data = "<?xml version=\"1.0\"?><videa_video/>".toByteArray()
        val enc = Videa.rc4(data, "k3y")
        assertTrue(!enc.contentEquals(data))
        assertEquals(String(data), String(Videa.rc4(enc, "k3y")))
    }

    @Test fun `videa token needs a full nonce`() {
        assertNull(Videa.token("<script>var _xt = \"short\";</script>"))
        val l = "xHb0ZvME5q8CBcoQi6AngerDu3FGO9fk" // كل حرف في السر
        val s = "abcdefghijklmnopqrstuvwxyz012345"
        assertEquals(32, Videa.token("_xt = \"$l$s\"")!!.length)
    }

    @Test fun `yonaplay sources and payload decrypt`() {
        val servers = Yonaplay.servers("""{"success":true,"title":"SNF EP 14","qualities":{"hd":{"servers":[{"name":"Mega","token":"t1"}]},"fhd":{"servers":[{"name":"Google","token":"t2"},{"name":"Mega","token":"t3"}]}}}""")
        assertEquals(listOf(1080, 1080, 720), servers.map { it.quality })
        assertEquals("Google", servers[0].name)
        val session = Yonaplay.session("""{"success":true,"c":"CODE","t":"T","k":"page-key"}""")!!
        assertEquals("page-key", session.key)

        // تشفير كما يفعل الخادم: iv(12) + tag(16) + النص المشفّر
        val url = "https://drive.google.com/file/d/1jYy2Ea-NsseFZfBmtUWGtK40Pn6jN_ke/preview"
        val key = MessageDigest.getInstance("SHA-256").digest("page-key".toByteArray())
        val iv = ByteArray(12) { it.toByte() }
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv)) }
        val out = c.doFinal(url.toByteArray())
        val ct = out.copyOfRange(0, out.size - 16)
        val tag = out.copyOfRange(out.size - 16, out.size)
        val d = Base64.getEncoder().encodeToString(iv + tag + ct)
        assertEquals(url, Yonaplay.decrypt(Yonaplay.payload("""{"success":true,"d":"$d","r":false}""")!!, "page-key"))
        assertNull(Yonaplay.decrypt(d, "wrong-key"))
    }
}
