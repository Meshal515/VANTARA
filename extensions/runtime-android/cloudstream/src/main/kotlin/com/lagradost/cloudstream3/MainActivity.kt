package com.lagradost.cloudstream3
import com.lagradost.nicehttp.Requests
val app:Requests=Requests()
class UiCapabilityRequired:UnsupportedOperationException("USER_INTERACTION_REQUIRED")
// An isolated worker has no foreground Activity. Polling must observe absence;
// visible verification remains an explicit host action, never an exception on its main looper.
object CommonActivity {fun getActivity():android.app.Activity?=null}
