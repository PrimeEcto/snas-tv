package com.snas.tv

import android.app.ActivityManager
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * What this device can actually play, and the app's own line into logcat.
 *
 * The app decides which HLS rendition to open from two things: what the provider's master playlist
 * says those renditions are, and what this device says it can decode. React Native supplies neither
 * of the second half — `Platform.constants` knows the model and nothing about memory, the process's
 * bit width, or the decoder's limits — so they are read here.
 *
 * The memory half matters as much as the codec half on the device this exists for. A 1st-generation
 * Fire TV Stick 4K (AFTMM) has 1.5 GB of RAM shared with a 32-bit userspace, and its own media
 * pipeline is documented failing to allocate decoder output buffers on exactly that model
 * (androidx/media#654: `createGraphicBuffer failed`, `ACodec … Out of memory (12)`). Notably it
 * reports the format as *supported* before failing, so a capability answer alone is not a licence:
 * the policy in `src/device-profile.ts` weighs memory and bit width too.
 *
 * Every read is defensive. A device that refuses a piece of platform data costs the app that one
 * field and nothing else; a probe that threw would cost the launch.
 */
class SnasDeviceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /** The device profile the player's rendition policy is decided with. */
  @ReactMethod
  fun info(promise: Promise) {
    try {
      promise.resolve(profile())
    } catch (error: Throwable) {
      // Resolve rather than reject: the JavaScript side treats a missing profile as "unknown, be
      // conservative", which is a playback decision, whereas a rejection would have to be caught
      // again at every call site.
      Log.w(TAG, "device profile could not be read", error)
      promise.resolve(Arguments.createMap())
    }
  }

  /**
   * One line into logcat under the `SNAS` tag, so a playback session can be read back with
   * `adb logcat -s SNAS` on a device nobody has a debugger attached to.
   */
  @ReactMethod
  fun log(level: String, message: String) {
    try {
      val priority =
          when (level.lowercase()) {
            "debug" -> Log.DEBUG
            "warn" -> Log.WARN
            "error" -> Log.ERROR
            else -> Log.INFO
          }
      Log.println(priority, TAG, message.take(900))
    } catch (_: Throwable) {
      // Logging is never worth a failure.
    }
  }

  private fun profile(): WritableMap {
    val map = Arguments.createMap()
    val context = reactApplicationContext

    put(map, "model", Build.MODEL)
    put(map, "brand", Build.BRAND)
    put(map, "manufacturer", Build.MANUFACTURER)
    put(map, "release", Build.VERSION.RELEASE)
    map.putInt("sdkInt", Build.VERSION.SDK_INT)

    val abis = Build.SUPPORTED_ABIS
    val abiList = Arguments.createArray()
    abis.forEach { abiList.pushString(it) }
    map.putArray("abis", abiList)
    put(map, "primaryAbi", if (abis.isNotEmpty()) abis[0] else null)
    map.putBoolean("is64Bit", abis.isNotEmpty() && abis[0].contains("64"))

    try {
      val manager = context.getSystemService(ActivityManager::class.java)
      if (manager != null) {
        map.putInt("memoryClassMb", manager.memoryClass)
        map.putInt("largeMemoryClassMb", manager.largeMemoryClass)
        map.putBoolean("isLowRamDevice", manager.isLowRamDevice)
        val limits = ActivityManager.MemoryInfo()
        manager.getMemoryInfo(limits)
        map.putDouble("totalMemMb", limits.totalMem.toDouble() / (1024 * 1024))
        map.putDouble("availMemMb", limits.availMem.toDouble() / (1024 * 1024))
      }
      val runtime = Runtime.getRuntime()
      map.putDouble("maxHeapMb", runtime.maxMemory().toDouble() / (1024 * 1024))
    } catch (error: Throwable) {
      Log.w(TAG, "memory could not be read", error)
    }

    try {
      map.putArray("codecs", codecProfiles())
    } catch (error: Throwable) {
      Log.w(TAG, "codec list could not be read", error)
    }
    return map
  }

  /**
   * One entry per video format the ladder could hand this device, with the decoder's own limits.
   *
   * `MediaCodecInfo.VideoCapabilities` has existed since API 21, so it is available on the Fire OS 6
   * stick. The limits are a decoder's *declaration*: on AFTMM the device declares support for frames
   * it then cannot allocate buffers for, which is why this is evidence to weigh and not an answer to
   * trust.
   */
  private fun codecProfiles() = Arguments.createArray().also { array ->
    val wanted =
        mapOf(
            "video/avc" to "avc",
            "video/hevc" to "hevc",
            "video/vp9" to "vp9",
            "video/av01" to "av1",
        )
    val infos =
        try {
          MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
        } catch (_: Throwable) {
          emptyArray<MediaCodecInfo>()
        }
    for ((mime, label) in wanted) {
      val entry = Arguments.createMap()
      entry.putString("mime", mime)
      entry.putString("label", label)
      val decoder = infos.firstOrNull { info -> supports(info, mime) }
      if (decoder == null) {
        entry.putBoolean("present", false)
        array.pushMap(entry)
        continue
      }
      entry.putBoolean("present", true)
      put(entry, "decoder", decoder.name)
      entry.putBoolean("hardware", hardware(decoder))
      val caps =
          try {
            decoder.getCapabilitiesForType(mime).videoCapabilities
          } catch (_: Throwable) {
            null
          }
      if (caps != null) {
        // Read defensively: a decoder that reports a strange range costs the app those numbers, and
        // never the profile the policy is built from.
        try {
          entry.putInt("maxWidth", caps.supportedWidths.upper.toInt())
          entry.putInt("maxHeight", caps.supportedHeights.upper.toInt())
          entry.putDouble("maxFrameRate", caps.supportedFrameRates.upper.toDouble())
        } catch (error: Throwable) {
          Log.w(TAG, "decoder limits could not be read for $mime", error)
        }
        // The exact frame the app's own ladder is most likely to hand it: a 4K-class rung, and the
        // cinemascope rung this backend serves. Asking directly is what makes the answer specific.
        entry.putBoolean("supports4k", caps.isSizeSupported(3840, 2160))
        entry.putBoolean("supports2584x1080", caps.isSizeSupported(2584, 1080))
      }
      array.pushMap(entry)
    }
  }

  private fun supports(info: MediaCodecInfo, mime: String): Boolean {
    if (info.isEncoder) return false
    return try {
      info.supportedTypes.any { it.equals(mime, ignoreCase = true) }
    } catch (_: Throwable) {
      false
    }
  }

  /**
   * Whether a decoder is hardware-backed.
   *
   * `MediaCodecInfo.isHardwareAccelerated()` arrived in API 29, so on the Fire OS 6 stick the name
   * is the only signal: a decoder that says `google`, `sw` or `c2.android` in its name is the
   * software fallback, and a software decoder is not something this app can fall back to on a
   * 1.7 GHz quad-core device.
   */
  private fun hardware(info: MediaCodecInfo): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      return try {
        info.isHardwareAccelerated
      } catch (_: Throwable) {
        true
      }
    }
    val name = info.name.lowercase()
    return !(name.contains("google") || name.contains("software") || name.contains("c2.android"))
  }

  private fun put(map: WritableMap, key: String, value: String?) {
    if (!value.isNullOrEmpty()) map.putString(key, value)
  }

  companion object {
    const val NAME = "SnasDevice"
    private const val TAG = "SNAS"
  }
}
