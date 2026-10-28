package com.lagradost.nicehttp

import com.fasterxml.jackson.databind.json.JsonMapper
import com.fasterxml.jackson.module.kotlin.KotlinModule
import com.lagradost.cloudstream3.mapper
import dev.vantara.runtime.cloudstream.NetworkBridge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.reflect.KClass

/** Original implementation of the observed public contract. No NiceHttp implementation is reused. */
interface ResponseParser {
    fun <T:Any> parse(text:String,kClass:KClass<T>):T
    fun <T:Any> parseSafe(text:String,kClass:KClass<T>):T?
    fun writeValueAsString(obj:Any):String
}
internal object JacksonParser:ResponseParser {
    override fun <T:Any> parse(text:String,kClass:KClass<T>):T=mapper.readValue(text,kClass.java)
    override fun <T:Any> parseSafe(text:String,kClass:KClass<T>):T?=runCatching{parse(text,kClass)}.getOrNull()
    override fun writeValueAsString(obj:Any):String=mapper.writeValueAsString(obj)
}
data class NiceFile(val name:String,val filename:String,val bytes:ByteArray,val type:String="application/octet-stream")
open class Requests {
    private val client by lazy {OkHttpClient.Builder().addInterceptor(NetworkBridge.interceptor()).retryOnConnectionFailure(false).build()}
    val baseClient:OkHttpClient get()=client
    suspend fun get(url:String,headers:Map<String,String> = emptyMap(),referer:String?=null,params:Map<String,String> = emptyMap(),cookies:Map<String,String> = emptyMap(),allowRedirects:Boolean=true,cacheTime:Int=0,cacheUnit:TimeUnit=TimeUnit.MINUTES,timeout:Long=20,interceptor:Interceptor?=null,verify:Boolean=true,responseParser:ResponseParser?=null):NiceResponse =
        perform("GET",url,headers,referer,params,cookies,null,null,null,null,allowRedirects,cacheTime,cacheUnit,timeout,interceptor,verify,responseParser)
    suspend fun post(url:String,headers:Map<String,String> = emptyMap(),referer:String?=null,params:Map<String,String> = emptyMap(),cookies:Map<String,String> = emptyMap(),data:Map<String,String>?=null,files:List<NiceFile>?=null,json:Any?=null,requestBody:RequestBody?=null,allowRedirects:Boolean=true,cacheTime:Int=0,cacheUnit:TimeUnit=TimeUnit.MINUTES,timeout:Long=20,interceptor:Interceptor?=null,verify:Boolean=true,responseParser:ResponseParser?=null):NiceResponse =
        perform("POST",url,headers,referer,params,cookies,data,files,json,requestBody,allowRedirects,cacheTime,cacheUnit,timeout,interceptor,verify,responseParser)
    suspend fun put(url:String,headers:Map<String,String> = emptyMap(),referer:String?=null,params:Map<String,String> = emptyMap(),cookies:Map<String,String> = emptyMap(),data:Map<String,String>?=null,files:List<NiceFile>?=null,json:Any?=null,requestBody:RequestBody?=null,allowRedirects:Boolean=true,cacheTime:Int=0,cacheUnit:TimeUnit=TimeUnit.MINUTES,timeout:Long=20,interceptor:Interceptor?=null,verify:Boolean=true,responseParser:ResponseParser?=null):NiceResponse =
        perform("PUT",url,headers,referer,params,cookies,data,files,json,requestBody,allowRedirects,cacheTime,cacheUnit,timeout,interceptor,verify,responseParser)
    private suspend fun perform(method:String,url:String,headers:Map<String,String>,referer:String?,params:Map<String,String>,cookies:Map<String,String>,data:Map<String,String>?,files:List<NiceFile>?,json:Any?,requestBody:RequestBody?,allowRedirects:Boolean,cacheTime:Int,cacheUnit:TimeUnit,timeout:Long,interceptor:Interceptor?,verify:Boolean,responseParser:ResponseParser?):NiceResponse = withContext(Dispatchers.IO) {
        if(!verify)throw IOException("TLS_VERIFICATION_DISABLE_UNSUPPORTED")
        if(cacheTime!=0)throw IOException("EXPLICIT_RESPONSE_CACHE_CAPABILITY_UNSUPPORTED")
        require(timeout in 1..30){"Invalid request deadline"}
        val parser=responseParser?:JacksonParser
        val endpoint=url.toHttpUrl().newBuilder().apply{params.forEach{(k,v)->addQueryParameter(k,v)}}.build()
        val body=when {
            method=="GET"->null
            requestBody!=null->requestBody
            json!=null->parser.writeValueAsString(json).toRequestBody("application/json; charset=utf-8".toMediaType())
            !files.isNullOrEmpty()->MultipartBody.Builder().setType(MultipartBody.FORM).apply{data?.forEach{(k,v)->addFormDataPart(k,v)};files.forEach{addFormDataPart(it.name,it.filename,it.bytes.toRequestBody(it.type.toMediaType()))}}.build()
            data!=null->FormBody.Builder().apply{data.forEach{(k,v)->add(k,v)}}.build()
            else->ByteArray(0).toRequestBody()
        }
        val request=Request.Builder().url(endpoint).apply{
            headers.forEach{(k,v)->header(k,v)}
            referer?.let{header("Referer",it)}
            if(cookies.isNotEmpty())header("Cookie",cookies.entries.joinToString("; "){it.key+"="+it.value})
        }.method(method,body).build()
        val configured=client.newBuilder().followRedirects(allowRedirects).followSslRedirects(allowRedirects).callTimeout(timeout,TimeUnit.SECONDS)
        if(interceptor!=null)configured.interceptors().add(0,interceptor)
        NiceResponse(configured.build().newCall(request).execute(),parser)
    }
}
