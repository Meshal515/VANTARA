package com.vantara.plugins.translation
/** Immutable metadata only; delayed original analysis cannot downgrade a rescue revision. */
class AnalysisHandoff<T>(private val maxEntries:Int,private val revision:(T)->Int) {
 private val values=LinkedHashMap<String,T>(32,.75f,true)
 @Synchronized operator fun get(key:String):T? = values[key]
 @Synchronized operator fun set(key:String,value:T) {
  val old=values[key]
  if(old!=null && revision(old)>revision(value)) return
  values[key]=value
  while(values.size>maxEntries) values.remove(values.entries.first().key)
 }
 @Synchronized fun clear() {values.clear()}
}
