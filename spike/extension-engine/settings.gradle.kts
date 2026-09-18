// Spike معزول: مشروع Gradle مستقل تمامًا عن `android/` (قشرة Capacitor في
// B6). لا يشترك معه في إعداد ولا في نسخة، فلا يستطيع أن يكسره.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        // injekt وquickjs يُنشران على JitPack وحده
        maven("https://jitpack.io")
    }
}
rootProject.name = "vantara-extension-spike"
include(":app")
