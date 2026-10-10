package com.vantara.proof
import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.PlaybackException
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.vantara.anime.player.together.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.Executors

class ProofActivity : Activity() {
 private val main=Handler(Looper.getMainLooper());private val network=Executors.newSingleThreadExecutor()
 private lateinit var p:ExoPlayer;private lateinit var tg:TogetherPlayer;private lateinit var overlay:FrameLayout
 private var ep=1;private var error:String?=null;private var stop=false;private val http=OkHttpClient()
 override fun onCreate(saved:Bundle?) { super.onCreate(saved)
  val base=intent.getStringExtra("base")!!;val token=intent.getStringExtra("user") ?: "guest"
  overlay=FrameLayout(this);val views=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL };overlay.addView(views);setContentView(overlay)
  val top=LinearLayout(this);top.addView(android.widget.TextView(this).apply{text="Together native proof"});views.addView(top)
  p=ExoPlayer.Builder(this).build();val video=PlayerView(this).apply{player=p};views.addView(video,LinearLayout.LayoutParams(-1,0,1f))
  val hooks=object:TogetherPlayer.Hooks {
   override val player get()=p
   override fun episode()=ep
   override fun sourceName()="Android asset"
   override fun freshToken()=token
   override fun message(text:String){}
   override fun hasNextEpisode()=false
   override fun switchToEpisode(n:Int){ep=n;tg.onPreparing();p.setMediaItem(MediaItem.fromUri("asset:///authored.mp4"));p.prepare();p.playWhenReady=true}
   override fun openPanel(title:String,build:(LinearLayout)->Unit) { val body=LinearLayout(this@ProofActivity).apply{orientation=LinearLayout.VERTICAL};build(body);overlay.addView(body) }
   override fun refreshPanel(){}
   override fun overlayHost()=overlay
  }
  tg=TogetherPlayer(this,http,TogetherLaunch(base,"ABCDEF",token,"sync","anime:42"),hooks);tg.mountStrip(top);tg.start()
  p.addListener(object:Player.Listener {
   override fun onPlaybackStateChanged(state:Int){if(state==Player.STATE_READY)tg.onReady()}
   override fun onPlayerError(e:PlaybackException){error=e.errorCodeName;tg.onFailed("Android asset")}
  });hooks.switchToEpisode(1)
  val tick=object:Runnable { override fun run(){if(stop)return
   val data=JSONObject().put("pos",p.currentPosition).put("at",System.currentTimeMillis()).put("playing",p.isPlaying).put("ready",p.playbackState==Player.STATE_READY).put("width",p.videoSize.width).put("episode",ep).put("error",error).put("host",tg.client.isHost).toString()
   network.execute {try {val req=Request.Builder().url("$base/native").post(data.toRequestBody("application/json".toMediaType())).build();http.newCall(req).execute().use{res->val actions=JSONObject(res.body!!.string()).optJSONArray("actions");if(actions!=null)main.post{for(i in 0 until actions.length()){val a=actions.getJSONObject(i);when(a.getString("op")){"play"->tg.onUserPlayPause(true);"pause"->tg.onUserPlayPause(false);"seek"->tg.onUserSeek(a.getLong("pos"));"load"->tg.client.command("load",0.0,"anime:42#2","Episode 2")}}}}}catch(_:Exception){} }
   main.postDelayed(this,150)
  }};main.post(tick)
 }
 override fun onDestroy(){stop=true;tg.destroy();p.release();network.shutdownNow();super.onDestroy()}
}
