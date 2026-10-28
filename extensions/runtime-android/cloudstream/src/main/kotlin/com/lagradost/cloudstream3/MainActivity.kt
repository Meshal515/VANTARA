package com.lagradost.cloudstream3
import com.lagradost.nicehttp.Requests
val app:Requests=Requests()
class UiCapabilityRequired:UnsupportedOperationException("USER_INTERACTION_REQUIRED")
object CommonActivity {fun getActivity():android.app.Activity?=throw UiCapabilityRequired()}
