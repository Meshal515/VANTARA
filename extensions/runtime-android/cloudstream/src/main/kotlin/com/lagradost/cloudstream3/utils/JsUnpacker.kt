package com.lagradost.cloudstream3.utils

/**
 * Reverses the widespread `eval(function(p,a,c,k,e,d){…}('payload',radix,count,'w0|w1|…'.split('|')…))`
 * packing used by video hosts to hide their player config. Pure string work: nothing is evaluated.
 */
class JsUnpacker(private val packedJS:String?) {
    private val packed=Regex("""\}\s*\(\s*'(.*)'\s*,\s*(\d+|\[\])\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\('\|'\)""",RegexOption.DOT_MATCHES_ALL)
    fun detect():Boolean=packedJS?.let{Regex("""eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*(?:r|d)""").containsMatchIn(it)}==true
    fun unpack():String? {
        val source=packedJS?:return null
        val match=packed.find(source)?:return null
        val payload=match.groupValues[1].replace("\\'","'").replace("\\\\","\\")
        val radix=match.groupValues[2].toIntOrNull()?:62
        val count=match.groupValues[3].toIntOrNull()?:return null
        val words=match.groupValues[4].split('|')
        if(words.size!=count||radix<2||radix>95)return null
        return Regex("""\b\w+\b""").replace(payload){token->
            val index=decode(token.value,radix)
            if(index!=null&&index<words.size&&words[index].isNotEmpty())words[index] else token.value
        }
    }
    private fun decode(word:String,radix:Int):Int? {
        val alphabet=when {
            radix<=36->"0123456789abcdefghijklmnopqrstuvwxyz"
            radix<=62->"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
            else->" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
        }.take(radix)
        var value=0L
        for(char in word) {
            val digit=alphabet.indexOf(char).takeIf{it>=0}?:return null
            value=value*radix+digit
            if(value>Int.MAX_VALUE)return null
        }
        return value.toInt()
    }
}
