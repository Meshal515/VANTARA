package com.vantara.plugins.translation
import java.io.File
import java.security.MessageDigest

/** Immutable candidates: the reader may reject a refresh without losing its accepted file. */
internal object PagePublisher {
 /** Evict only enough old outputs to meet the keep budget; accepted current-page variants stay. */
 fun prune(dir:File,protectedHash:String,cap:Long,keep:Long) {
  val files=dir.listFiles {f->f.name.endsWith(".webp")}?.sortedBy {it.lastModified()} ?: return
  var total=files.sumOf {it.length()}
  if(total<=cap) return
  for(f in files) {
   if(total<=keep) break
   if(f.name.startsWith("$protectedHash-")) continue
   val size=f.length()
   if(f.delete()) total-=size
  }
 }
 fun publish(dir:File,hash:String,bytes:ByteArray):File {
  dir.mkdirs()
  val digest=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }.take(12)
  val out=File(dir,"$hash-$digest.webp")
  if(!out.exists() || out.length()!=bytes.size.toLong()) {
   val tmp=File(dir,"${out.name}.part")
   java.io.FileOutputStream(tmp).use {it.write(bytes);it.fd.sync()}
   if(!tmp.renameTo(out)) {tmp.delete();error("cannot publish translated page")}
  }
  return out
 }
}
