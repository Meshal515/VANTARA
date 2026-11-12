package com.vantara.plugins

/**
 * رقم الفصل كما كتبه المصدر لا كما يتسرّب من Float (#323 U-28).
 *
 * `SChapter.chapter_number` من نوع Float، و`356.1f.toDouble()` يعطي `356.1000061035156`، فيصل
 * للواجهة رقمان مختلفان للفصل نفسه (من مصدر يمر بـFloat وآخر بنص) فيتكرر الفصل وتتفرّق مفاتيح
 * التقدم. أقصر تمثيل عشري للـFloat هو ما يقصده المصدر: `356.1f.toString()` = "356.1".
 */
internal object ChapterNumbers {
    fun forJs(number: Float): Double =
        if (number.isFinite()) number.toString().toDouble() else number.toDouble()
}
