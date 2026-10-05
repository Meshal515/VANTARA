package com.vantara.plugins.translation
import kotlin.math.abs
/** Cheap proposal only. No region may be erased until OCR confirms and normal mask gates pass. */
object MissingTextSweep {
 fun candidates(img:RgbImage,known:List<Detection>,limit:Int=12):List<Box> {
  val scale=minOf(1f,768f/img.width,2048f/img.height)
  val small=if(scale<1) img.resize(maxOf(1,(img.width*scale).toInt()),maxOf(1,(img.height*scale).toInt())) else img
  val gray=small.gray();val proposals=ArrayList<Box>()
  for(light in listOf(false,true)) {
   val ink=ByteMask(small.width,small.height)
   for(y in 1 until small.height-1) for(x in 1 until small.width-1) {
    val v=gray[y*small.width+x].toInt() and 255
    if(if(light) v>210 else v<90) ink[x,y]=1
   }
   val parts=ink.components().second.filter {
    val w=it.x1-it.x0;val h=it.y1-it.y0
    w in 2..48 && h in 4..48 && it.area>=4 && it.area<.85*w*h && w.toFloat()/h in .1f..3.2f
   }.sortedWith(compareBy({it.y0},{it.x0}))
   val lines=ArrayList<MutableList<ByteMask.Component>>()
   for(c in parts) {
    val line=lines.lastOrNull {row->val last=row.last();abs((last.y0+last.y1)-(c.y0+c.y1))<maxOf(last.y1-last.y0,c.y1-c.y0) && c.x0-last.x1 in -2..maxOf(12,3*(c.y1-c.y0))}
    if(line==null) lines.add(arrayListOf(c)) else line.add(c)
   }
   for(row in lines.filter {it.size>=3}) {
    val b=Box(maxOf(0,((row.minOf{it.x0}-4)/scale).toInt()),maxOf(0,((row.minOf{it.y0}-4)/scale).toInt()),minOf(img.width,((row.maxOf{it.x1}+4)/scale).toInt()),minOf(img.height,((row.maxOf{it.y1}+4)/scale).toInt()))
    if(known.any {it.label.startsWith("text") && it.score>=Regions.MIN_SCORE && it.box.contains(b)>.4f} || proposals.any{it.iou(b)>.5f}) continue
    proposals.add(b)
   }
  }
  return proposals.sortedWith(compareBy({it.y1},{it.x1})).take(limit)
 }
 fun confirmed(text:String,confidence:Float)= confidence>=.80f && Regex("[A-Za-z]{2,}").containsMatchIn(text)
}
