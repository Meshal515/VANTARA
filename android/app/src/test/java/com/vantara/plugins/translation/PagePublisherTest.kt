package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
class PagePublisherTest {
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
