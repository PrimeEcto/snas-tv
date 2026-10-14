package com.snas.tv

import android.app.Activity
import android.view.KeyEvent
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/**
 * Fire OS remote keys, forwarded to JavaScript.
 *
 * Plain React Native moves focus between views natively — that is how the D-pad works here — but it
 * never hands the key itself to JavaScript. Without this, the app cannot see a key press at all:
 * the remote's play/pause, rewind and fast-forward buttons do nothing, and, because the player
 * screen shows its control bar for six seconds and then waits for a key to bring it back, the
 * controls become unreachable the moment they hide.
 *
 * `firetv/tv/android.ts` is the receiving half of this contract: it listens for `keyDown`/`keyUp`
 * on the device event emitter and maps the codes onto TV event names. This is the half that emits
 * them. Every event is reported and then passed on to `super.dispatchKeyEvent`, so native focus
 * search keeps working exactly as it did before.
 */
object RemoteKeys {
  fun report(activity: Activity, event: KeyEvent) {
    val context =
        (activity.application as? ReactApplication)?.reactHost?.currentReactContext ?: return
    val payload: WritableMap = Arguments.createMap().apply { putInt("keyCode", event.keyCode) }
    val name = if (event.action == KeyEvent.ACTION_DOWN) "keyDown" else "keyUp"
    try {
      context.emitDeviceEvent(name, payload)
    } catch (_: Throwable) {
      // A key event must never take the app down, whatever state the JS runtime is in.
    }
  }
}
