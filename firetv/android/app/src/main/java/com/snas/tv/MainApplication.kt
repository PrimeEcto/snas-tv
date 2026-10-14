package com.snas.tv

import android.app.Application
import android.util.Log
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
          // Autolinking covers react-native-video, react-native-svg and async-storage.
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
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
}
