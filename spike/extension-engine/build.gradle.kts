// إصدار Kotlin ليس ذوقًا — هو قيد.
//
// اللفّة الرابعة سقطت بـ:
//   kotlin-stdlib-2.2.21 … metadata is 2.2.0, expected version is 2.0.0
//   okhttp-5.3.2 · okio-3.16.4 … metadata is 2.2.0
//
// أي أن الاعتماديات مبنيّة بـKotlin 2.2 وتسحب stdlib 2.2.21، ومُصرِّف 2.0
// لا يقرأ بياناتها. والقاعدة: **المُصرِّف ≥ البيانات التي يقرؤها**. فلا
// يُخفَّض الاعتماد — الإضافات مبنيّة على هذه الخطوط — بل يُرفع المُصرِّف.
//
// ولا أُسكت الفحص بـ`-Xskip-metadata-version-check`: إسكاتُ تحذيرٍ بنيوي
// يؤجّل الانهيار إلى زمن التشغيل، وهناك يُقرأ كعطل مصدر.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.2.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.2.21" apply false
}
