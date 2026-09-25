package com.vantara.anime.net

import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import javax.net.SocketFactory

/**
 * يقسّم أول كتابة كبيرة (رسالة ClientHello، وفيها اسم الموقع SNI بلا تشفير)
 * إلى كتابتين بينهما تفريغ (flush)، فيصل اسم الموقع في حزمة IP منفصلة عن
 * ترويسة السجل. جدار حجب يفحص الحزمة الأولى فقط من كل اتصال (شائع لأن فحص
 * كل حزمة لكل اتصال HTTPS مكلف على مستوى مزوّد كامل) لا يرى الاسم إطلاقًا؛
 * جدار يعيد تجميع التدفق كاملًا يبقى يراه.
 *
 * تشخيص جهاز حقيقي أظهر بالضبط هذا النمط: اتصال TCP نجح، ومصافحة TLS
 * انقطعت فورًا بـ«Connection reset» — لا عطل في الموقع ولا في الشبكة، بل
 * تدخّل يحقن قطعًا عند رؤية الاسم. هذا تخمين مدروس لا حلًّا مضمونًا؛
 * `AnimeEngine.diagnose` يُري نتيجته الحقيقية على شبكة كل مستخدم.
 */
object SniFragment {
    /** يكفي أن يقع القسم الأول قبل أي بيانات مفيدة؛ لا حاجة لمعرفة مكان SNI بدقة. */
    const val SPLIT_OFFSET = 5
}

/** مصنع مقابس OkHttp يستخدمه فقط لطلبات المقبس الخام (بلا وسيطة)؛ التوثيق في [SniFragment]. */
class SniFragmentingSocketFactory : SocketFactory() {
    override fun createSocket(): Socket = FragmentingSocket()

    override fun createSocket(host: String, port: Int): Socket =
        FragmentingSocket().also { it.connect(InetSocketAddress(host, port)) }

    override fun createSocket(host: String, port: Int, localAddress: InetAddress, localPort: Int): Socket =
        FragmentingSocket().also {
            it.bind(InetSocketAddress(localAddress, localPort))
            it.connect(InetSocketAddress(host, port))
        }

    override fun createSocket(address: InetAddress, port: Int): Socket =
        FragmentingSocket().also { it.connect(InetSocketAddress(address, port)) }

    override fun createSocket(address: InetAddress, port: Int, localAddress: InetAddress, localPort: Int): Socket =
        FragmentingSocket().also {
            it.bind(InetSocketAddress(localAddress, localPort))
            it.connect(InetSocketAddress(address, port))
        }
}

/** مقبس عادي بالكامل إلا كتابته الأولى الكبيرة؛ آمن لإعادة الاستخدام في تشخيص يدوي أيضًا. */
class FragmentingSocket : Socket() {
    private val wrapped by lazy(LazyThreadSafetyMode.NONE) { SniFragmentingOutputStream(super.getOutputStream()) }

    override fun getOutputStream(): OutputStream = wrapped

    override fun connect(endpoint: java.net.SocketAddress, timeout: Int) {
        super.connect(endpoint, timeout)
        // Nagle قد يُعيد دمج الكتابتين في حزمة واحدة، فيُبطل التقسيم
        runCatching { tcpNoDelay = true }
    }
}

internal class SniFragmentingOutputStream(private val out: OutputStream) : OutputStream() {
    private var armed = true

    override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

    override fun write(b: ByteArray) = write(b, 0, b.size)

    override fun write(b: ByteArray, off: Int, len: Int) {
        if (armed) {
            armed = false
            if (len > SniFragment.SPLIT_OFFSET + 1) {
                out.write(b, off, SniFragment.SPLIT_OFFSET)
                out.flush()
                out.write(b, off + SniFragment.SPLIT_OFFSET, len - SniFragment.SPLIT_OFFSET)
                out.flush()
                return
            }
        }
        out.write(b, off, len)
    }

    override fun flush() = out.flush()

    override fun close() = out.close()
}
