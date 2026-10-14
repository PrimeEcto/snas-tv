package com.snas.tv

import android.view.KeyEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /** Must match AppRegistry.registerComponent in firetv/index.js. */
  override fun getMainComponentName(): String = "com.snas.tv.main"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Report the key to JavaScript, then let React Native handle it as usual.
   *
   * Both halves matter: the app needs to see the remote's media buttons and to know that a key was
   * pressed, and the D-pad still has to move focus between views — so this never consumes the event.
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    RemoteKeys.report(this, event)
    return super.dispatchKeyEvent(event)
  }
}
