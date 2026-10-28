package dev.vantara.runtime.bootstrap;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;

/** Debug-only dependency. Register before BridgeActivity.onCreate builds its bridge. */
public final class RuntimeBootstrap extends ContentProvider {
    @Override public boolean onCreate() {
        if(Build.VERSION.SDK_INT<29)return true;
        Application app=(Application)getContext().getApplicationContext();
        app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks(){
            @Override public void onActivityPreCreated(Activity activity,Bundle state){
                if(!activity.getClass().getName().equals("com.vantara.app.MainActivity"))return;
                try {
                    Class<?> plugin=Class.forName("com.vantara.runtime.RuntimePlugin",false,activity.getClassLoader());
                    activity.getClass().getMethod("registerPlugin",Class.class).invoke(activity,plugin);
                }catch(ReflectiveOperationException|LinkageError error){
                    // A bridge wiring defect is visible to developers; it cannot crash the user's Activity.
                    android.util.Log.e("VantaraRuntime","DEBUG_BRIDGE_REGISTRATION_FAILED",error);
                }
            }
            public void onActivityCreated(Activity a,Bundle b){}
            public void onActivityStarted(Activity a){}
            public void onActivityResumed(Activity a){}
            public void onActivityPaused(Activity a){}
            public void onActivityStopped(Activity a){}
            public void onActivitySaveInstanceState(Activity a,Bundle b){}
            public void onActivityDestroyed(Activity a){}
        });
        return true;
    }
    public Cursor query(Uri u,String[] p,String s,String[] a,String o){throw new UnsupportedOperationException();}
    public String getType(Uri u){return null;}
    public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
    public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}
