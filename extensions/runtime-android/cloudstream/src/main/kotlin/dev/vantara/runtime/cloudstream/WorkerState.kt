package dev.vantara.runtime.cloudstream

import android.content.Context
import android.content.SharedPreferences
import com.lagradost.cloudstream3.mapper

/**
 * State one isolated worker generation may hold for its provider: its wrapped context, a key/value store
 * scoped to that provider, and clearance cookies the host handed over after an explicit verification.
 * Nothing here reaches the host app's stores. A new generation starts from what the host passes in.
 */
object WorkerState {
    @Volatile var context:Context?=null
    private val values=java.util.concurrent.ConcurrentHashMap<String,String>()
    @Volatile private var clearance:Map<String,Map<String,String>> = emptyMap()
    val preferences:SharedPreferences=ScopedPreferences(values)

    fun <T> setKey(path:String,value:T){if(value==null)values.remove(path) else values[path]=mapper.writeValueAsString(value)}
    @Suppress("UNCHECKED_CAST") fun <T> getKey(path:String):T?=values[path]?.let{runCatching{mapper.readValue(it,Any::class.java) as T}.getOrNull()}
    fun clearanceCookies():Map<String,Map<String,String>> =clearance
    private val missing=java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    /** Hosts a provider handed to loadExtractor that no extractor handles; reported with the operation's result. */
    // One embed link per unhandled host: diagnostic evidence for writing and testing that host's extractor.
    private val samples=java.util.concurrent.ConcurrentHashMap<String,String>()
    fun missingExtractor(host:String,url:String?=null){
        val key=host.lowercase(java.util.Locale.ROOT).removePrefix("www.")
        if(missing.size<64)missing.add(key)
        if(url!=null&&url.length<=512&&samples.size<64)samples.putIfAbsent(key,url)
    }
    fun takeMissingExtractors():List<String> =missing.toList().sorted().also{missing.clear()}
    fun takeMissingSamples():Map<String,String> =samples.toSortedMap().also{samples.clear()}
    fun install(context:Context?,saved:Map<String,String> = emptyMap(),cookies:Map<String,Map<String,String>> = emptyMap()) {
        this.context=context;values.clear();values.putAll(saved);clearance=cookies
    }
    /** What the host may persist for this provider after the generation ends. */
    fun snapshot():Map<String,String> =HashMap(values)
    fun reset(){context=null;values.clear();clearance=emptyMap()}
}

/** SharedPreferences over the worker map. Values keep their Java type inside one generation. */
internal class ScopedPreferences(private val raw:MutableMap<String,String>):SharedPreferences {
    private val typed=java.util.concurrent.ConcurrentHashMap<String,Any>()
    private val listeners=java.util.concurrent.CopyOnWriteArraySet<SharedPreferences.OnSharedPreferenceChangeListener>()
    private fun value(key:String):Any?=typed[key]?:raw[key]
    override fun getAll():MutableMap<String,*> =HashMap<String,Any?>().apply{raw.forEach{(k,v)->put(k,v)};putAll(typed)}
    override fun getString(key:String,defValue:String?):String?=value(key) as? String?:defValue
    @Suppress("UNCHECKED_CAST") override fun getStringSet(key:String,defValues:MutableSet<String>?):MutableSet<String>?=(typed[key] as? Set<String>)?.toMutableSet()?:defValues
    override fun getInt(key:String,defValue:Int):Int=(value(key) as? Number)?.toInt()?:(value(key) as? String)?.toIntOrNull()?:defValue
    override fun getLong(key:String,defValue:Long):Long=(value(key) as? Number)?.toLong()?:(value(key) as? String)?.toLongOrNull()?:defValue
    override fun getFloat(key:String,defValue:Float):Float=(value(key) as? Number)?.toFloat()?:(value(key) as? String)?.toFloatOrNull()?:defValue
    override fun getBoolean(key:String,defValue:Boolean):Boolean=(value(key) as? Boolean)?:(value(key) as? String)?.toBooleanStrictOrNull()?:defValue
    override fun contains(key:String):Boolean=typed.containsKey(key)||raw.containsKey(key)
    override fun edit():SharedPreferences.Editor=Editor()
    override fun registerOnSharedPreferenceChangeListener(listener:SharedPreferences.OnSharedPreferenceChangeListener){listeners.add(listener)}
    override fun unregisterOnSharedPreferenceChangeListener(listener:SharedPreferences.OnSharedPreferenceChangeListener){listeners.remove(listener)}
    private inner class Editor:SharedPreferences.Editor {
        private val puts=HashMap<String,Any?>();private var clear=false
        override fun putString(key:String,value:String?)=apply{puts[key]=value}
        override fun putStringSet(key:String,values:MutableSet<String>?)=apply{puts[key]=values?.toSet()}
        override fun putInt(key:String,value:Int)=apply{puts[key]=value}
        override fun putLong(key:String,value:Long)=apply{puts[key]=value}
        override fun putFloat(key:String,value:Float)=apply{puts[key]=value}
        override fun putBoolean(key:String,value:Boolean)=apply{puts[key]=value}
        override fun remove(key:String)=apply{puts[key]=null}
        override fun clear()=apply{clear=true}
        override fun commit():Boolean {
            if(clear){typed.clear();raw.clear()}
            for((key,value) in puts) {
                if(value==null){typed.remove(key);raw.remove(key)}
                else {typed[key]=value;raw[key]=if(value is Set<*>)mapper.writeValueAsString(value) else value.toString()}
            }
            puts.keys.forEach{key->listeners.forEach{it.onSharedPreferenceChanged(this@ScopedPreferences,key)}}
            return true
        }
        override fun apply(){commit()}
    }
}
