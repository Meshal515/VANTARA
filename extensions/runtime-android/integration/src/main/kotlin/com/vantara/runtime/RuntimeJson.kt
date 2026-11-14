package com.vantara.runtime

import kotlinx.serialization.json.*

/** Bound nesting before a recursive JSON decoder sees untrusted repository/worker output. */
internal object RuntimeJson {
    private val codec=Json { ignoreUnknownKeys=true }
    fun parse(text: String): JsonElement {
        require(text.length<=4*1024*1024) { "JSON_SIZE_LIMIT" }
        var depth=0;var quoted=false;var escaped=false
        for(char in text) {
            if(quoted) { if(escaped)escaped=false else if(char=='\\')escaped=true else if(char=='"')quoted=false }
            else when(char) { '"'->quoted=true;'[','{'->{depth++;require(depth<=32) { "JSON_NESTING_LIMIT" }};']','}'->{depth--;require(depth>=0) { "INVALID_JSON" }} }
        }
        require(!quoted && depth==0) { "INVALID_JSON" }
        return codec.parseToJsonElement(text)
    }
}
