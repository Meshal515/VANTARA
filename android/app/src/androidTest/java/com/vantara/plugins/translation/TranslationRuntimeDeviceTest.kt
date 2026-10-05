package com.vantara.plugins.translation

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Real models and Android pixels; Arabic replies are controlled, not a Luna E2E claim. */
@RunWith(AndroidJUnit4::class)
class TranslationRuntimeDeviceTest {
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private fun fixture(name:String):File = File(context.cacheDir,name).also {file->
        instrumentation.context.assets.open(name).use {input->file.outputStream().use {input.copyTo(it)}}
    }
    @Test fun originalModelsDetectRenderAndReopenAcceptedOutput() {
        val store=ModelStore(context)
        store.requireInstalled() // Caller must preload exact pinned model artifacts.
        val source=fixture("source-flat.png")
        val pipeline=Pipeline(context,store)
        val render=Pipeline(context,store,renderOnly=true)
        try {
            val routing=Perf();val routed=pipeline.route(source,routing)
            assertFalse("real detector missed every English line",routed.textless)
            val analysisPerf=Perf();val (a,thumbnail)=pipeline.finishForLuna(source,analysisPerf,routed)
            assertEquals(routed.pageHash,a.pageHash)
            assertTrue(thumbnail.isNotEmpty())
            assertTrue("actual OCR must read English",a.regions.count {Regex("[A-Za-z]{2,}").containsMatchIn(it.source)}>=2)
            val replies=a.regions.filter {it.source.isNotBlank()}.associate {r->r.id to when {
                r.source.contains("KING",true)->"الحاكم هنا"
                r.source.contains("GO",true)->"لا تذهب"
                else->"ساحرنا يعرف الحقيقة"
            }}
            render.acceptAnalysis(a)
            val outputDir=File(context.filesDir,"translation-runtime-evidence").apply {mkdirs()}
            val renderPerf=Perf();val (output,count)=render.render(source,replies,outputDir,renderPerf)
            assertTrue("renderer accepted no Arabic regions",count>=2)
            val original=BitmapFactory.decodeFile(source.absolutePath)!!
            val result=BitmapFactory.decodeFile(output.absolutePath)!!
            try {
                assertEquals(original.width,result.width);assertEquals(original.height,result.height)
                var changed=0
                for(y in 0 until original.height) for(x in 0 until original.width) {
                    if(original.getPixel(x,y)==result.getPixel(x,y)) continue
                    changed++
                    assertTrue("pixel outside known text/bubble bounds changed",a.regions.any {r->val b=r.bubbleBox?.union(r.box) ?: r.box;x>=b.x1-Regions.GLYPH_MARGIN && x<b.x2+Regions.GLYPH_MARGIN && y>=b.y1-Regions.GLYPH_MARGIN && y<b.y2+Regions.GLYPH_MARGIN})
                }
                assertTrue(changed>100)
                File(outputDir,"rendered-flat.png").outputStream().use {result.compress(Bitmap.CompressFormat.PNG,100,it)}
            } finally {original.recycle();result.recycle()}
            File(outputDir,"evidence.json").writeText(JSONObject().put("device",android.os.Build.MODEL).put("physical",false).put("luna","controlled replies; UNVERIFIED live provider").put("rendered",count).put("route",JSONObject(routing.millis())).put("analysis",JSONObject(analysisPerf.millis())).put("render",JSONObject(renderPerf.millis())).put("counts",JSONObject(renderPerf.counts)).toString(2))
            val acceptedBytes=output.readBytes()
            render.render(source,emptyMap(),outputDir,Perf()) // Worse refresh is rejected by reader.
            assertArrayEquals(acceptedBytes,output.readBytes())
            assertTrue(output.exists() && output.length()>0)
            assertNotNull(BitmapFactory.decodeFile(output.absolutePath)?.also {it.recycle()})
        } finally {pipeline.unload();render.unload()}
    }

    @Test fun realMangaPageUsesOriginalModelsAndSavesVisibleArabic() {
        val store=ModelStore(context);store.requireInstalled()
        val source=fixture("source-real-magician.jpg")
        val pipeline=Pipeline(context,store);val render=Pipeline(context,store,renderOnly=true)
        try {
            val route=pipeline.route(source,Perf());assertFalse(route.textless)
            val (a,_)=pipeline.finishForLuna(source,Perf(),route)
            assertTrue(a.regions.any {it.source.length>=2})
            render.acceptAnalysis(a)
            val replies=a.regions.filter {it.source.isNotBlank()}.associate {it.id to "ساحرنا يعرف الحقيقة"}
            val dir=File(context.filesDir,"translation-runtime-evidence").apply {mkdirs()}
            val (output,count)=render.render(source,replies,dir,Perf())
            assertTrue(count>0)
            val bitmap=BitmapFactory.decodeFile(output.absolutePath)!!
            File(dir,"rendered-real-magician.png").outputStream().use {bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
            bitmap.recycle()
        } finally {pipeline.unload();render.unload()}
    }
    @Test fun textlessPageExitsWithoutHeavyModels() {
        val pipeline=Pipeline(context,ModelStore(context))
        try {
            val perf=Perf();assertTrue(pipeline.route(fixture("source-textless.png"),perf).textless)
            assertFalse(perf.nanos.keys.any {it in setOf("glyphs","bubbles","load:ctd","load:bubbleseg","load:lama")})
        } finally {pipeline.unload()}
    }

    @Test fun residualRescueReadsFarLineInOversizedHolder() {
        // Deliberately stale analysis: only the upper line was detected. The lower
        // line is >800px away, and the holder exceeds a single CTD tile.
        val dir=File(context.filesDir,"translation-runtime-evidence").apply {mkdirs()}
        val source=File(dir,"source-rescue.png")
        val bitmap=Bitmap.createBitmap(720,1450,Bitmap.Config.ARGB_8888)
        val canvas=Canvas(bitmap)
        canvas.drawColor(Color.rgb(220,220,220))
        val paint=Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color=Color.WHITE;canvas.drawRect(80f,100f,640f,1350f,paint)
        paint.color=Color.BLACK;paint.textSize=38f;paint.textAlign=Paint.Align.CENTER
        canvas.drawText("MY KING KNOWS",360f,270f,paint)
        canvas.drawText("DO NOT GO",360f,1150f,paint)
        source.outputStream().use {bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
        bitmap.recycle()
        val store=ModelStore(context);store.requireInstalled()
        val pipeline=Pipeline(context,store)
        try {
            val route=pipeline.route(source,Perf())
            val holder=Box(80,100,640,1350)
            val stale=Box(170,225,550,285)
            val glyph=ByteMask(720,1450).apply {fillRect(stale.x1,stale.y1,stale.x2,stale.y2)}
            val bubble=ByteMask(720,1450).apply {fillRect(holder.x1,holder.y1,holder.x2,holder.y2)}
            val snapshot=Pipeline.Snapshot("stale",stale,.95f,"speech",0,holder,PackedMask.of(glyph),glyph.count(),false,null,"MY KING KNOWS","pending")
            pipeline.acceptAnalysis(Pipeline.Analysis(route.pageHash,720,1450,listOf(snapshot),listOf(Pipeline.BubbleSnapshot(holder,.95f,PackedMask.of(bubble))),rescue=listOf(holder)))
            val perf=Perf()
            val (repaired,_)=pipeline.finishForLuna(source,perf)
            assertTrue("missed far line must enter actual OCR",repaired.regions.any {it.source.contains("GO",true)})
            assertTrue("upper line must also survive holder reanalysis",repaired.regions.any {it.source.contains("KING",true)})
            assertTrue("repair must own glyphs beyond the stale box",repaired.regions.any {it.glyph.unpack().bounds()?.get(3)?.let {bottom->bottom>1100} == true})
            val render=Pipeline(context,store,renderOnly=true)
            try {
                render.acceptAnalysis(repaired)
                val (output,count)=render.render(source,repaired.regions.filter {it.source.isNotBlank()}.associate {it.id to "حاكمنا يعرف الحقيقة فلا تذهب"},dir,Perf())
                assertTrue("complete repaired holder must render",count>0)
                val result=BitmapFactory.decodeFile(output.absolutePath)!!
                File(dir,"rendered-rescue.png").outputStream().use {result.compress(Bitmap.CompressFormat.PNG,100,it)}
                result.recycle()
            } finally {render.unload()}
        } finally {pipeline.unload()}
    }
}
