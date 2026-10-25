package com.snas.tv

import android.app.Application
import android.util.Log
import java.io.File
import java.util.Date
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider

/**
 * The release's own feature flags, with imperative focus turned on.
 *
 * `ref.focus()` is the only way the app has to put the remote's focus where a screen wants it (see
 * src/ui/focus.tsx), and React Native gates it behind `enableImperativeFocus`, which is off on
 * Android. Off, every `focus()` call is a silent no-op: nothing is focused when a screen opens and
 * Android's geometric focus search decides instead — entering the Search tab left the highlight on
 * the navigation bar, and the next Down press reached the results list rather than the letter grid.
 *
 * Delegation keeps the rest of the flags exactly as React Native set them: this only changes the one
 * that matters here, and it follows the same OSS-stable provider `loadReactNative` installs.
 */
private class SnasFocusFeatureFlags(private val base: ReactNativeFeatureFlagsProvider) :
    ReactNativeFeatureFlagsProvider by base {

  override fun enableImperativeFocus(): Boolean = true
}

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Autolinking covers react-native-video, react-native-svg and async-storage; this app's
          // own module reports what the device can decode and writes the playback log.
          add(SnasDevicePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    recordFatalExceptions()
    loadReactNative(this)

    // This has to happen once the runtime is loaded: `loadReactNative` is what installs the release's
    // flags (and initialises SoLoader, which the native feature-flag module needs), so overriding
    // before it either throws or is replaced. `dangerouslyForceOverride` is the supported way to
    // change a flag afterwards — it swaps in a fresh flag set, which is why the base above has to
    // reproduce the release's own values rather than fall back to React Native's defaults.
    try {
      val alreadyRead =
        ReactNativeFeatureFlags.dangerouslyForceOverride(
          SnasFocusFeatureFlags(ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android())
        )
      if (alreadyRead != null) {
        // Reported rather than ignored: a flag that was read before this point keeps its old value,
        // and the symptom would be a remote that cannot reach a screen's controls.
        Log.w("SNAS", "imperative focus was enabled after these flags had been read: $alreadyRead")
      }
    } catch (error: Throwable) {
      Log.e("SNAS", "imperative focus could not be enabled; screens cannot place focus", error)
    }
  }

  /**
   * Write a fatal Java/Kotlin exception to logcat and to a file before the process dies.
   *
   * The failure this app is being diagnosed for can be a decoder that takes the process with it, in
   * which case nothing in the app can report it — but when it *is* a throwable on some thread, the
   * default handler's stack trace is the whole diagnosis, and it should not depend on logcat having
   * been running. The file is written to both the app's private files directory and its external
   * one, so it can be read back over adb on an installed release build:
   *
   *   adb shell cat /sdcard/Android/data/com.snas.tv/files/last-crash.txt
   *
   * A native (SIGSEGV/SIGABRT) failure never reaches this handler; for those, logcat carries the
   * tombstone, and `adb logcat -b crash` should be read instead.
   */
  private fun recordFatalExceptions() {
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        Log.e("SNAS", "fatal exception on ${thread.name}", error)
        val report = "${Date()}\n${thread.name}\n${Log.getStackTraceString(error)}\n"
        val targets =
          listOfNotNull(
            filesDir,
            try {
              getExternalFilesDir(null)
            } catch (_: Throwable) {
              null
            },
          )
        for (directory in targets) {
          try {
            File(directory, "last-crash.txt").writeText(report)
          } catch (_: Throwable) {
            // A read-only or full filesystem must not replace the crash with a second one.
          }
        }
      } catch (_: Throwable) {
        // Never let reporting the crash be worse than the crash.
      }
      previous?.uncaughtException(thread, error)
    }
  }
}
