package com.vantara.plugins.translation

import android.content.res.AssetManager
import android.graphics.Typeface

/** Twenty packaged OFL families, loaded on demand. No network or model-controlled file paths. */
class FontCatalog(private val assets: AssetManager) {
    private val faces = HashMap<String, Typeface>()
    private val layouts = HashMap<String, ArabicLayout>()
    companion object {
        val families = listOf("baloobhaijaan2","cairo","tajawal","changa","reemkufi","notosansarabic","notokufiarabic","notonaskharabic","amiri","arefruqaa","rakkas","lemonada","elmessiri","almarai","beiruti","playpensansarabic","harmattan","markazitext","mada","kufam")
        private val roleFamily = LetteringStyle.roles.zip(listOf(
            "baloobhaijaan2","tajawal","harmattan","lemonada","notonaskharabic","cairo","arefruqaa","amiri","playpensansarabic","beiruti","changa","kufam","notosansarabic","reemkufi","notokufiarabic","rakkas","almarai","mada","elmessiri","markazitext"
        )).toMap()
    }
    fun typeface(role: String): Typeface {
        val family = roleFamily[role] ?: "baloobhaijaan2"
        return faces.getOrPut(family) {
            runCatching { Typeface.createFromAsset(assets,"fonts/translation-v2/$family.ttf") }.getOrElse {
                Typeface.createFromAsset(assets,"fonts/BalooBhaijaan2.ttf")
            }
        }
    }
    fun layout(style: LetteringStyle): ArabicLayout = layouts.getOrPut("${style.role}:${style.bold}") { ArabicLayout(typeface(style.role),style.bold) }
}
