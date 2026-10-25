package com.snas.tv

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

/**
 * Registers `SnasDeviceModule`.
 *
 * `BaseReactPackage` rather than the older `ReactPackage`: this app runs React Native's New
 * Architecture (`fabricEnabled`), where `createNativeModules` is not supported, and a package that
 * used it would register nothing and leave the device profile unreadable.
 */
class SnasDevicePackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == SnasDeviceModule.NAME) SnasDeviceModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
        SnasDeviceModule.NAME to
            ReactModuleInfo(
                SnasDeviceModule.NAME,
                SnasDeviceModule::class.java.name,
                false, // canOverrideExistingModule
                false, // needsEagerInit
                false, // isCxxModule
                false, // isTurboModule
            )
    )
  }

  override fun createViewManagers(
      reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
