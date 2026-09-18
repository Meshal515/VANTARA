plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    // الإضافات تُصرَّف بـkotlinx.serialization، ومولّداتها تحتاج وقت التشغيل
    id("org.jetbrains.kotlin.plugin.serialization")
}

// إصدار OkHttp في مكان واحد: التوحيد أدناه والاعتماديات تقرأ منه، فلا
// يفترقان بالسهو.
//
// ويُصرَّح **بعد** `plugins`: الـKotlin DSL يمنع أي تصريح قبل كتلة
// الإضافات، ووجوده فوقها كان سيُسقط اللفّة التالية.
val okhttpVersion = "5.3.2"

android {
    namespace = "dev.vantara.spike"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.vantara.spike"
        // إضافات lib 1.6 تُشحن بـminSdk 26. وأجهزتنا كلها 13+، فلا مسار
        // خفض DEX مطلوب أصلًا — لكن الأرضية تبقى 26 حتى لا نَعِد بما لا نُثبت.
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "spike-1"
    }

    buildTypes {
        // debug فقط: لا توقيع إنتاجي، ولا لمس لأسرار B6
        getByName("debug") {
            isMinifyEnabled = false
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    sourceSets {
        getByName("main") { kotlin.srcDirs("src/main/kotlin") }
    }

    packaging {
        // ثماني اعتماديات تشحن كلٌّ نسختها من ملفات META-INF نفسها، ودامج
        // الموارد يرفض التكرار:
        //
        //   DuplicateRelativeFileException: 3 files found with path
        //   'META-INF/versions/9/OSGI-INF/MANIFEST.MF'
        //
        // وهذه بيانات وصفية لـOSGi والتراخيص، لا يقرؤها التطبيق ولا الإضافة
        // في زمن التشغيل. فإسقاطها إسقاطُ تكرار لا إسقاطُ وظيفة.
        //
        // ولا أستعمل `pickFirst` هنا: «خذ أولها» يُخفي تعارضًا حقيقيًّا لو
        // وقع يومًا في ملفٍ يهمّ، بينما `excludes` يقول صراحة ما أُسقط.
        resources.excludes += setOf(
            "META-INF/*.kotlin_module",
            "META-INF/versions/**/OSGI-INF/**",
            "META-INF/OSGI-INF/**",
            "META-INF/DEPENDENCIES",
            "META-INF/LICENSE*",
            "META-INF/NOTICE*",
            "META-INF/INDEX.LIST",
            "META-INF/*.SF",
            "META-INF/*.DSA",
            "META-INF/*.RSA",
        )
    }
}

// ─────────────────────────────────────────────────────────────────────
// توحيد OkHttp بالقوة.
//
// الإضافات تُصرَّف على OkHttp، وبعض الاعتماديات تسحب وحدات مختلفة منه
// (okhttp, okhttp-urlconnection, …). فإن بقيت واحدة على 4.x وأخرى على 5.x
// انكسر الرابط: `okhttp3.JavaNetCookieJar` في 4.x يشير إلى
// `okhttp3.internal.Util` وقد حُذف في 5.x، فينهار التطبيق بـ
// NoClassDefFoundError في أول طلب. هذا درسٌ موثَّق في Kagari، وأثبّته هنا
// بدل أن أتعلّمه من جديد.
// ─────────────────────────────────────────────────────────────────────
configurations.all {
    resolutionStrategy.eachDependency {
        if (requested.group == "com.squareup.okhttp3") {
            useVersion(okhttpVersion)
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // `ConfigurableSource.setupPreferenceScreen` يأخذ PreferenceScreen في
    // توقيعه. أي إضافة تنفّذه تشير إلى androidx.preference، فغيابه يعني
    // NoClassDefFoundError عند تحميل الصنف لا عند استعماله.
    implementation("androidx.preference:preference-ktx:1.2.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // الشبكة. الإصدارات مثبَّتة بقصد: الإضافات مبنيّة على هذه الخطوط.
    implementation("com.squareup.okhttp3:okhttp:$okhttpVersion")
    // `okhttp3.JavaNetCookieJar` يسكن هذه القطعة لا في okhttp نفسه
    implementation("com.squareup.okhttp3:okhttp-urlconnection:$okhttpVersion")
    implementation("com.squareup.okhttp3:okhttp-brotli:$okhttpVersion")
    // Keiyoushi's exact common host surface includes okhttp-zstd. Azora proved
    // this is runtime-required: NoClassDefFoundError okhttp3/zstd/Zstd.
    implementation("com.squareup.okhttp3:okhttp-zstd:$okhttpVersion")
    implementation("com.squareup.okio:okio:3.16.4")

    // Jsoup: خط 1.x الذي تُصرَّف عليه keiyoushi
    implementation("org.jsoup:jsoup:1.22.2")

    // RxJava **1.x**: عقد lib 1.4 يرجع `rx.Observable`، لا Rx2 ولا Rx3
    implementation("io.reactivex:rxjava:1.3.8")

    // التسلسل. `-json-okio` ليس زائدًا: الإضافات تقرأ أجسام JSON عبر okio
    // (`kotlinx.serialization.json.okio.OkioStreamsKt`)، وبلا هذه القطعة
    // يسقط المصدر عند أول استجابة JSON.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json-okio:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-protobuf:1.8.1")

    // injekt: الإضافات تحصل على NetworkHelper و Json بـ`injectLazy()`
    implementation("com.github.null2264.injekt:injekt-core:4135455a2a")

    // بعض المصادر تُقيّم JavaScript لفكّ روابط الصفحات
    implementation("com.github.zhanghai.quickjs-java:quickjs-android:547f5b1597")
}
