package dev.vantara.spike

import kotlinx.coroutines.suspendCancellableCoroutine
import rx.Observable
import rx.Subscription
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * جسر RxJava **1** إلى coroutine.
 *
 * عقد `extensions-lib 1.4` يرجع `rx.Observable`، وعقد `1.6` يرجع `suspend`.
 * وسطح التوافق يجسر بينهما، فيحتاج `awaitSingle` — وهي في Mihon وKagari
 * داخل حزمتهما الخاصة (`com.manhwa.engine` عند Kagari)، فلم تأتِ مع ما
 * نسختُه من `eu/kanade/tachiyomi/`. كتبتُها هنا.
 *
 * ولا تُؤخذ من `kotlinx-coroutines-rx`: تلك القطعة لـRxJava **2/3**، ونحن
 * على 1.3.8 لأن عقد الإضافات عليه. خلطُهما يُصرَّف ثم ينهار عند أول نداء.
 *
 * والدلالة: أول انبعاث يكفي ونُنهي. ومصادر `1.4` تُنتج قيمة واحدة، لكن
 * الحارس موجود لأن `resume` مرتين ترمي `IllegalStateException` يُقرأ كعطل
 * مصدر وهو عطل جسر.
 */
suspend fun <T> Observable<T>.awaitSingle(): T = suspendCancellableCoroutine { cont ->
    var settled = false
    var subscription: Subscription? = null

    subscription = this.subscribe(
        { value ->
            if (!settled) {
                settled = true
                cont.resume(value)
                // لا ننتظر `onCompleted`: بعض المصادر تُبقي التدفق مفتوحًا
                subscription?.unsubscribe()
            }
        },
        { error ->
            if (!settled) {
                settled = true
                cont.resumeWithException(error)
            }
        },
        {
            // اكتمل بلا انبعاث: خطأٌ صريح خيرٌ من تعليقٍ صامت إلى الأبد
            if (!settled) {
                settled = true
                cont.resumeWithException(
                    NoSuchElementException("Observable completed without emitting a value"),
                )
            }
        },
    )

    cont.invokeOnCancellation { subscription?.unsubscribe() }
}
