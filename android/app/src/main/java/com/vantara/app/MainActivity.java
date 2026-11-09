package com.vantara.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
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
        registerPlugin(ExtensionEnginePlugin.class);
        registerPlugin(SystemUiPlugin.class);
        registerPlugin(com.vantara.plugins.AccountBackupPlugin.class);
        registerPlugin(com.vantara.addons.AddonEnginePlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(TranslationPlugin.class);
        registerPlugin(com.vantara.anime.bridge.AnimeEnginePlugin.class);
        registerPlugin(com.vantara.usage.UsagePlugin.class);
        registerPlugin(com.vantara.verification.VerificationPlugin.class);
        super.onCreate(savedInstanceState);
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
