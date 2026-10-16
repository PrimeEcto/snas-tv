package com.snas.tv

import android.view.KeyEvent
import android.os.Bundle
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    hideSystemBars()
  }

  private fun hideSystemBars() {
    WindowInsetsControllerCompat(window, window.decorView).apply {
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(WindowInsetsCompat.Type.systemBars())
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideSystemBars()
  }

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
