package dev.vantara.runtime.cloudstream

import dev.vantara.runtime.api.RuntimeHttpAccess
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.ResponseBody.Companion.toResponseBody

/** Conversion shared by raw OkHttp and NiceResponse parsing paths. */
internal object BrokerResponses {
    fun convert(request:Request,answer:RuntimeHttpAccess.Response):Response {
        val finalRequest=request.newBuilder().url(answer.url()).build()
        val headers=Headers.Builder().apply{answer.headers().forEach{(name,values)->values.forEach{add(name,it)}}}.build()
        return Response.Builder().request(finalRequest).protocol(Protocol.HTTP_1_1).code(answer.status()).message("Broker response").headers(headers).body(answer.body().toResponseBody(headers["Content-Type"]?.toMediaTypeOrNull())).build()
    }
}
