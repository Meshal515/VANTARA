package com.vantara.runtime

import kotlinx.serialization.json.*

/** Empty answers are observations, never ABI errors or proof of site failure.
 * A rollback additionally needs the previous revision to satisfy the exact same input.
 */
internal object RuntimeOperationHealth {
    enum class Result { PRODUCTIVE, EMPTY, NEUTRAL }
    fun assess(operation:String,input:JsonObject,result:JsonObject,source:JsonObject):Result {
        if(operation=="search" || operation !in setOf("catalogue","details","episodes","videoLinks"))return Result.NEUTRAL
        if(operation=="catalogue" && ((input["page"] as? JsonPrimitive)?.intOrNull?.let { it>1 }==true ||
                (source["hasMainPage"] as? JsonPrimitive)?.booleanOrNull==false))return Result.NEUTRAL
        val productive=runCatching {
            when(operation) {
                "catalogue" -> RuntimeCanaryContract.firstWorkUrl(result).isNotBlank()
                "details" -> {RuntimeCanaryContract.requireDetails(result);true}
                "episodes" -> RuntimeCanaryContract.firstEpisodeData(result).isNotBlank()
                "videoLinks" -> RuntimeCanaryContract.mediaUrls(result).isNotEmpty()
                else -> false
            }
        }.getOrDefault(false)
        return if(productive)Result.PRODUCTIVE else Result.EMPTY
    }
    fun recordSuccess(gate:RuntimeRecoveryGate,key:String,health:Result) {
        if(health==Result.PRODUCTIVE)gate.onSuccess(key)
    }
}
