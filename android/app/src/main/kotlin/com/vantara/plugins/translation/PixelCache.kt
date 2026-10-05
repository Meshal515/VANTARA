package com.vantara.plugins.translation
/** Owner-local immutable pixels, bounded by bytes as well as frame count. */
class PixelCache<T>(private val maxEntries:Int,private val maxBytes:Long,private val bytesOf:(T)->Long) {
 private val values=LinkedHashMap<String,T>(8,.75f,true)
 var retainedBytes=0L;private set
 operator fun get(key:String):T? = values[key]
 operator fun set(key:String,value:T) {
  remove(key)
  val bytes=bytesOf(value)
  if(bytes>maxBytes) return
  values[key]=value;retainedBytes+=bytes
  while(values.size>maxEntries || retainedBytes>maxBytes) remove(values.entries.first().key)
 }
 fun remove(key:String):T? = values.remove(key)?.also {retainedBytes-=bytesOf(it)}
 fun clear() {values.clear();retainedBytes=0}
}
