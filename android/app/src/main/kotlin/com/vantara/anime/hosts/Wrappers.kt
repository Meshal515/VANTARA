package com.vantara.anime.hosts

import com.vantara.anime.stream.Container
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * videa.hu: صفحة المشغّل تحمل رمزًا (`_xt`) يُعاد ترتيبه بسرّ ثابت؛ به يُطلب
 * `/player/xml` فيرجع XML (أو نسخة مشفّرة RC4 بمفتاح من الرمز + رأس
 * `x-videa-xs`) فيه روابط كل جودة مع md5 وتاريخ انتهاء. بلا متصفح.
 * مجرّب على حلقة حقيقية (WitAnime، Frieren 14): 240p mp4 و480p/1080p webm.
 */
internal object Videa {
    private const val SECRET = "xHb0ZvME5q8CBcoQi6AngerDu3FGO9fkUlwPmLVY_RTzj2hJIS4NasXWKy1td7p"
    private val NONCE = Regex("""_xt\s*=\s*"([^"]+)"""")

    /** رمز الطلب من `_xt`: أول 16 للطلب، والباقي لمفتاح فك RC4. */
    fun token(playerHtml: String): String? {
        val nonce = NONCE.find(playerHtml)?.groupValues?.get(1)?.takeIf { it.length >= 64 } ?: return null
        val l = nonce.substring(0, 32)
        val s = nonce.substring(32)
        return buildString {
            for (i in 0 until 32) {
                val k = SECRET.indexOf(l[i])
                if (k < 0) return null
                val idx = i - (k - 31)
                append(s[if (idx < 0) s.length + idx else idx])
            }
        }
    }

    fun rc4(data: ByteArray, key: String): ByteArray {
        val k = key.toByteArray(Charsets.UTF_8)
        val st = IntArray(256) { it }
        var j = 0
        for (i in 0 until 256) {
            j = (j + st[i] + (k[i % k.size].toInt() and 0xff)) and 0xff
            st[i] = st[j].also { st[j] = st[i] }
        }
        var i = 0
        j = 0
        return ByteArray(data.size) { n ->
            i = (i + 1) and 0xff
            j = (j + st[i]) and 0xff
            st[i] = st[j].also { st[j] = st[i] }
            (data[n].toInt() xor st[(st[i] + st[j]) and 0xff]).toByte()
        }
    }

    data class Source(val url: String, val height: Int?, val mime: String)

    private val SOURCES_EXP = Regex("""<video_sources[^>]*\bexp="(\d+)"""")
    private val SOURCE = Regex("""<video_source\b([^>]*)>([^<]+)</video_source>""")
    private fun attr(attrs: String, name: String) = Regex("""\b$name="([^"]*)"""").find(attrs)?.groupValues?.get(1)

    /** الجودات من XML، الأعلى أولًا، بروابط موقّعة (md5 + expires). */
    fun sources(xml: String): List<Source> {
        val exp = SOURCES_EXP.find(xml)?.groupValues?.get(1)
        return SOURCE.findAll(xml).mapNotNull { m ->
            val attrs = m.groupValues[1]
            val name = attr(attrs, "name") ?: return@mapNotNull null
            val raw = m.groupValues[2].trim().replace("&amp;", "&")
            val hash = Regex("""<hash_value_${Regex.escape(name)}>([^<]+)<""").find(xml)?.groupValues?.get(1)
            val itemExp = attr(attrs, "exp") ?: exp
            var url = if (raw.startsWith("//")) "https:$raw" else raw
            if (hash != null && itemExp != null) url += (if ('?' in url) "&" else "?") + "md5=$hash&expires=$itemExp"
            Source(url, attr(attrs, "height")?.toIntOrNull(), attr(attrs, "mimetype").orEmpty())
        }.sortedByDescending { it.height ?: 0 }.toList()
    }

    fun toStreams(list: List<Source>, pageUrl: String, userAgent: String?): List<Stream> = list.map {
        Stream(
            url = it.url,
            headers = buildMap {
                put("Referer", pageUrl)
                userAgent?.let { ua -> put("User-Agent", ua) }
            },
            quality = it.height,
            label = "videa",
            container = Container.MP4,
        )
    }
}

/**
 * yonaplay: صفحة «اختر مصدرًا» تغلّف سيرفرات أخرى (Google Drive، Mega…).
 * `api/init-session.php` ← جلسة، `api/sources.php` ← الجودات وسيرفراتها،
 * `api/api.php` لكل سيرفر ← رابط صفحته مشفّرًا AES-GCM بمفتاح SHA-256 من
 * `k` الجلسة. الرابط الناتج يُحل كأي سيرفر آخر. بلا متصفح.
 */
internal object Yonaplay {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    data class Session(val code: String, val key: String)
    data class Server(val token: String, val name: String, val quality: Int?)

    fun session(body: String): Session? = runCatching {
        val o = json.parseToJsonElement(body).jsonObject
        if (o["success"]?.jsonPrimitive?.booleanOrNull != true) return null
        Session(o["c"]!!.jsonPrimitive.content, o["k"]!!.jsonPrimitive.content)
    }.getOrNull()

    private val QUALITY = mapOf("uhd" to 2160, "4k" to 2160, "fhd" to 1080, "hd" to 720, "sd" to 480, "ld" to 360)

    fun servers(body: String): List<Server> = runCatching {
        val o = json.parseToJsonElement(body).jsonObject
        val qs = o["qualities"]?.jsonObject ?: return emptyList()
        qs.entries.flatMap { (q, g) ->
            (g as? JsonObject)?.get("servers")?.jsonArray.orEmpty().mapNotNull { s ->
                val so = s.jsonObject
                val token = so["token"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                Server(token, so["name"]?.jsonPrimitive?.contentOrNull.orEmpty(), QUALITY[q.lowercase()] ?: Regex("""\d{3,4}""").find(q)?.value?.toIntOrNull())
            }
        }.sortedByDescending { it.quality ?: 0 }
    }.getOrDefault(emptyList())

    /** `d` من api.php: base64(iv[12] + tag[16] + ciphertext). */
    fun decrypt(data: String, pageKey: String): String? = runCatching {
        val raw = Base64.getDecoder().decode(data)
        val iv = raw.copyOfRange(0, 12)
        val tag = raw.copyOfRange(12, 28)
        val ct = raw.copyOfRange(28, raw.size)
        val key = MessageDigest.getInstance("SHA-256").digest(pageKey.toByteArray(Charsets.UTF_8))
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        String(c.doFinal(ct + tag), Charsets.UTF_8)
    }.getOrNull()?.takeIf { it.startsWith("http") }

    fun payload(body: String): String? = runCatching {
        val o = json.parseToJsonElement(body).jsonObject
        if (o["success"]?.jsonPrimitive?.booleanOrNull != true) null else o["d"]?.jsonPrimitive?.contentOrNull
    }.getOrNull()
}
