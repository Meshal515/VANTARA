package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
class PagePublisherTest {
 @Test fun `pruning stops at keep budget and preserves protected outputs`() {
  val dir=Files.createTempDirectory("translated-prune").toFile()
  try {
   fun output(name:String,time:Long)=java.io.File(dir,name).apply {writeBytes(ByteArray(40){7});assertTrue(setLastModified(time))}
   val protected=output("active-accepted.webp",1000)
   val oldest=output("oldest.webp",2000)
   val middle=output("middle.webp",3000)
   val newest=output("newest.webp",4000)
   val unrelated=java.io.File(dir,"metadata.json").apply {writeText("preserve metadata")}
   PagePublisher.prune(dir,"active",120,80)
   assertFalse(oldest.exists());assertFalse(middle.exists())
   assertTrue("newest output was needlessly evicted",newest.exists())
   assertArrayEquals(ByteArray(40){7},protected.readBytes())
   assertTrue(unrelated.exists())
   assertEquals(80L,dir.listFiles()!!.filter {it.name.endsWith(".webp")}.sumOf {it.length()})
  } finally {dir.deleteRecursively()}
 }
 @Test fun `cache at cap is not pruned and protected prefix is exact`() {
  val dir=Files.createTempDirectory("translated-cap").toFile()
  try {
   val accepted=java.io.File(dir,"active-accepted.webp").apply {writeBytes(ByteArray(40));setLastModified(1000)}
   val newest=java.io.File(dir,"newest.webp").apply {writeBytes(ByteArray(40));setLastModified(3000)}
   PagePublisher.prune(dir,"active",80,40)
   assertTrue(accepted.exists());assertTrue(newest.exists())
   val similar=java.io.File(dir,"activeOther.webp").apply {writeBytes(ByteArray(40));setLastModified(2000)}
   PagePublisher.prune(dir,"active",80,80)
   assertFalse("only hash plus hyphen is protected",similar.exists())
   assertTrue(accepted.exists());assertTrue(newest.exists())
  } finally {dir.deleteRecursively()}
 }
 @Test fun `rejected replacement leaves accepted output readable with original bytes`() {
  val dir=Files.createTempDirectory("translated-output").toFile()
  try {
   val accepted=PagePublisher.publish(dir,"a".repeat(64),byteArrayOf(1,2,3))
   val rejected=PagePublisher.publish(dir,"a".repeat(64),byteArrayOf(4,5))
   assertNotEquals(accepted,rejected)
   assertArrayEquals(byteArrayOf(1,2,3),accepted.readBytes())
   assertArrayEquals(byteArrayOf(4,5),rejected.readBytes())
   assertEquals(accepted,PagePublisher.publish(dir,"a".repeat(64),byteArrayOf(1,2,3)))
   assertEquals(2,dir.listFiles()!!.size)
  } finally {dir.deleteRecursively()}
 }
}
