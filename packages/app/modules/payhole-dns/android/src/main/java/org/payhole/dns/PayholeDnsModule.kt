package org.payhole.dns

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.provider.Settings
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class StartConfig : Record {
  @Field val dohUrl: String? = null
  @Field val dotHost: String? = null
  @Field val label: String = "PayHole"
}

/** Bridges the DNS tunnel service to JavaScript: consent, start, stop, state, and events. */
class PayholeDnsModule : Module() {
  private companion object {
    const val REQUEST_VPN_CONSENT = 4663
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var pendingConsent: Promise? = null
  private val stateListener: () -> Unit = { sendEvent("stateChanged", TunnelState.snapshot()) }

  override fun definition() = ModuleDefinition {
    Name("PayholeDns")

    Events("stateChanged")

    OnCreate {
      appContext.reactContext?.let { TunnelState.attach(it) }
      TunnelState.addListener(stateListener)
    }

    OnDestroy { TunnelState.removeListener(stateListener) }

    Function("isSupported") { true }

    AsyncFunction("prepare") { promise: Promise ->
      val consent = VpnService.prepare(context)
      if (consent == null) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      pendingConsent?.resolve(false)
      pendingConsent = promise
      activity.startActivityForResult(consent, REQUEST_VPN_CONSENT)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == REQUEST_VPN_CONSENT) {
        pendingConsent?.resolve(payload.resultCode == Activity.RESULT_OK)
        pendingConsent = null
      }
    }

    AsyncFunction("requestNotificationPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val granted = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
      if (granted) {
        promise.resolve(true)
        return@AsyncFunction
      }
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions,
        promise,
        Manifest.permission.POST_NOTIFICATIONS
      )
    }

    Function("start") { config: StartConfig ->
      val intent = Intent(context, DnsVpnService::class.java)
        .setAction(DnsVpnService.ACTION_START)
        .putExtra(DnsVpnService.EXTRA_DOH_URL, config.dohUrl)
        .putExtra(DnsVpnService.EXTRA_DOT_HOST, config.dotHost)
        .putExtra(DnsVpnService.EXTRA_LABEL, config.label)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      Unit
    }

    Function("stop") {
      val intent = Intent(context, DnsVpnService::class.java).setAction(DnsVpnService.ACTION_STOP)
      runCatching { context.startService(intent) }
      Unit
    }

    Function("getState") { TunnelState.snapshot() }

    Function("openSettings") {
      val intent = Intent(Settings.ACTION_VPN_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      runCatching { context.startActivity(intent) }
      Unit
    }
  }
}
