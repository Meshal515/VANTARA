package com.vantara.app;

import android.os.Build;
import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.vantara.plugins.AppUpdatePlugin;
import com.vantara.plugins.ExtensionEnginePlugin;
import com.vantara.plugins.SystemUiPlugin;
import com.vantara.plugins.translation.TranslationPlugin;
import eu.kanade.tachiyomi.network.interceptor.WebViewActivityHolder;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // التسجيل قبل super: الجسر يبني قائمة الإضافات داخل onCreate، وما
        // يُسجَّل بعده لا تراه صفحة الويب.
        // Debug وحده: آخر انهيار يُحفظ محليًا ويُنسخ من «نسخ تشخيص التحقق» (لا سجل انهيار غيره)
        if (BuildConfig.DEBUG) com.vantara.verification.DebugCrashLog.install(this);
        registerPlugin(ExtensionEnginePlugin.class);
        registerPlugin(SystemUiPlugin.class);
        registerPlugin(com.vantara.plugins.AccountBackupPlugin.class);
        registerPlugin(com.vantara.addons.AddonEnginePlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(TranslationPlugin.class);
        registerPlugin(com.vantara.anime.bridge.AnimeEnginePlugin.class);
        registerPlugin(com.vantara.downloads.DownloadsPlugin.class);
        registerPlugin(com.vantara.plugins.StoragePlugin.class);
        registerPlugin(com.vantara.usage.UsagePlugin.class);
        registerPlugin(com.vantara.verification.VerificationPlugin.class);
        registerPlugin(com.vantara.notify.NotifyPlugin.class);
        // مخزن «آخر التحديثات» الدائم (SQLite في filesDir)
        registerPlugin(com.vantara.plugins.LatestStorePlugin.class);
        super.onCreate(savedInstanceState);
        keepRendererAlive();
    }

    /**
     * بلاغ المالك (منذ أول APK): الخروج من المشغّل يرجعه أحيانًا لتسجيل الدخول أو كأن التطبيق فُتح للتو. محرك رسم
     * WebView عملية منفصلة، وأندرويد يقتله أولًا لاسترداد الذاكرة حين تكون الواجهة في الخلفية (المشغّل بـMedia3 وlibtorrent
     * فوقها). Capacitor 6 يرجع false من onRenderProcessGone ما لم يتولّه مستمع، وfalse يجعل النظام يُنهي التطبيق كله؛
     * فيبدأ من الصفر وتأكيد PIN (sessionStorage) ضاع معه.
     * (1) أولوية المحرك «مهمة» ولا تسقط حين تختفي الواجهة: لا يكون أول ضحية والمشغّل فوقها.
     * (2) إن مات رغم ذلك: يُتولّى (true) ويُعاد بناء النشاط بـWebView جديد، والتطبيق والمشغّل باقيان.
     */
    private void keepRendererAlive() {
        if (getBridge() == null) return;
        WebView view = getBridge().getWebView();
        if (view != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                // WebView الميت لا يُستعمل بعد الآن (توثيق أندرويد): يُبنى النشاط بجسر وWebView جديدين
                runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) recreate(); });
                return true;
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        WebViewActivityHolder.resumed(this);
    }

    @Override
    public void onPause() {
        WebViewActivityHolder.paused(this);
        super.onPause();
    }

    @Override
    public void onDestroy() {
        WebViewActivityHolder.clear(this);
        super.onDestroy();
    }
}
