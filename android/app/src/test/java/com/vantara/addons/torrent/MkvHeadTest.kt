package com.vantara.addons.torrent

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream

class MkvHeadTest {
    private fun element(id: Long, content: ByteArray, out: ByteArrayOutputStream, sizeBytes: Int = 4) {
        val idBytes = java.math.BigInteger.valueOf(id).toByteArray().dropWhile { it == 0.toByte() }
        idBytes.forEach { out.write(it.toInt()) }
        // حجم بطول [sizeBytes]: أول بت تعليم الطول
        val size = content.size.toLong()
        for (i in sizeBytes - 1 downTo 0) {
            var b = ((size shr (8 * i)) and 0xFF).toInt()
            if (i == sizeBytes - 1) b = b or (0x80 shr (sizeBytes - 1))
            out.write(b)
        }
        out.write(content)
    }

    /** ملف مثل حلقات الأنمي المقيسة: رأس صغير، ثم مرفقات كبيرة، ثم أول Cluster. */
    private fun anime(attachments: Int): Pair<ByteArray, Int> {
        val out = ByteArrayOutputStream()
        element(MkvHead.EBML, ByteArray(20) { 1 }, out, sizeBytes = 1)
        listOf(0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF).forEach(out::write) // Segment بحجم مجهول
        element(0x114D9B74L, ByteArray(60) { 2 }, out, sizeBytes = 2)
        element(0xECL, ByteArray(30), out, sizeBytes = 1)
        element(0x1549A966L, ByteArray(40) { 3 }, out)
        element(0x1654AE6BL, ByteArray(900) { 4 }, out, sizeBytes = 2)
        val attachmentsAt = out.size()
        element(MkvHead.ATTACHMENTS, ByteArray(attachments) { 5 }, out)
        element(0x1254C367L, ByteArray(100) { 6 }, out, sizeBytes = 2)
        val clusterAt = out.size()
        element(MkvHead.CLUSTER, ByteArray(5000) { 7 }, out)
        return out.toByteArray() to clusterAt
    }

    /** نفس منطق Lease.read: داخل المرفقات أصفار بلا قراءة، وغير ذلك من الملف ثم يمرّ على MkvHead. */
    private fun play(file: ByteArray, chunk: Int, head: MkvHead): Pair<ByteArray, Long> {
        val seen = ByteArray(file.size)
        var position = 0L
        var fromDisk = 0L
        while (position < file.size) {
            val count = minOf(chunk.toLong(), file.size - position).toInt()
            val skip = head.skip
            if (skip != null && position in skip) {
                val n = minOf(count.toLong(), skip.last + 1 - position).toInt()
                head.skipped(n); position += n; continue
            }
            file.copyInto(seen, position.toInt(), position.toInt(), position.toInt() + count)
            fromDisk += count
            head.feed(position, seen, position.toInt(), count)
            position += count
        }
        return seen to fromDisk
    }

    @Test fun `large attachments are recognised from the bytes already read and never fetched`() {
        val (file, clusterAt) = anime(3 * 1024 * 1024)
        for (chunk in listOf(1, 3, 7, 12, 13, 64, 4096, 1 shl 20)) {
            val head = MkvHead()
            val (seen, fromDisk) = play(file, chunk, head)
            val skip = head.skip!!
            assertEquals("chunk $chunk", 3L * 1024 * 1024, skip.last - skip.first + 1)
            assertEquals("chunk $chunk", clusterAt.toLong(), head.clusterAt)
            // ما وقع من المرفقات في نفس القراءة التي حملت رأسها يُقرأ عاديًا، والباقي يُتخطى
            assertTrue("chunk $chunk skipped ${head.skippedBytes}", head.skippedBytes >= 3L * 1024 * 1024 - chunk)
            assertTrue("chunk $chunk read $fromDisk", fromDisk <= file.size - 3L * 1024 * 1024 + chunk)
            // كل ما خارج المرفقات وصل المشغّل كما هو؛ داخلها أصفار أو الأصل
            for (i in file.indices) if (i.toLong() !in skip) assertEquals("chunk $chunk byte $i", file[i], seen[i])
                else assertTrue(seen[i] == 0.toByte() || seen[i] == file[i])
            assertEquals("SeekHead 60B · Void 30B · Info 40B · Tracks 900B · Attachments 3.0MB · Tags 100B · Cluster عند ${MkvHead.size(clusterAt.toLong())}", head.describe())
        }
    }

    @Test fun `small attachments are read normally and the layout is still reported`() {
        val (file, clusterAt) = anime(100 * 1024)
        val head = MkvHead()
        val (seen, _) = play(file, 4096, head)
        assertNull(head.skip)
        assertEquals(clusterAt.toLong(), head.clusterAt)
        assertArrayEquals(file, seen)
    }

    @Test fun `a file that is not MKV is never touched`() {
        val head = MkvHead()
        val mp4 = ByteArray(5000) { (it % 251).toByte() }.also { "\u0000\u0000\u0000\u0018ftypmp42".toByteArray().copyInto(it) }
        val (seen, _) = play(mp4, 777, head)
        assertNull(head.skip); assertNull(head.describe()); assertArrayEquals(mp4, seen)
    }

    @Test fun `a jump before the header stops tracking instead of guessing`() {
        val (file, _) = anime(3 * 1024 * 1024)
        val head = MkvHead()
        head.feed(0, file, 0, 40)
        // المشغّل قفز (قراءة الذيل) قبل أن يمرّ برأس المرفقات
        head.feed(file.size - 100L, file, file.size - 100, 100)
        head.feed(40, file, 40, file.size - 40)
        assertNull(head.skip)
    }
}
