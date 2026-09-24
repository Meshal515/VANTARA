package com.vantara.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.vantara.plugins.AppUpdatePlugin;
import com.vantara.plugins.ExtensionEnginePlugin;
import com.vantara.plugins.SystemUiPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // التسجيل قبل super: الجسر يبني قائمة الإضافات داخل onCreate، وما
        // يُسجَّل بعده لا تراه صفحة الويب.
        registerPlugin(ExtensionEnginePlugin.class);
        registerPlugin(SystemUiPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
