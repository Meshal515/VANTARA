package com.lagradost.nicehttp

import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import java.nio.charset.Charset

/** Response snapshots keep repeated parser/text reads meaningful after the stream closes. */
class NiceResponse(val response:Response,private val responseParser:ResponseParser?=null) {
    private val bytes:ByteArray=response.body?.use{it.bytes()}?:ByteArray(0)
    val code:Int get()=response.code
    val url:String get()=response.request.url.toString()
    val headers:Headers get()=response.headers
    val body:ResponseBody get()=bytes.toResponseBody(response.body?.contentType())
    val parser:ResponseParser get()=responseParser?:JacksonParser
    val isSuccessful:Boolean get()=code in 200..299
    val text:String by lazy {bytes.toString(response.body?.contentType()?.charset(Charsets.UTF_8)?:Charsets.UTF_8)}
    val document:Document get()=Jsoup.parse(text,url)
    val cookies:Map<String,String> get()=Cookie.parseAll(response.request.url,response.headers).associate{it.name to it.value}
    fun <T:Any> parsed(kClass:kotlin.reflect.KClass<T>):T=parser.parse(text,kClass)
}
