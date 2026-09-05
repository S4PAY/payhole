import ExpoModulesCore
import NetworkExtension
import UIKit

struct StartConfig: Record {
  @Field var dohUrl: String? = nil
  @Field var dotHost: String? = nil
  @Field var label: String = "PayHole"
}

/**
 * Saves an encrypted DNS setting for the whole device. iOS installs it immediately but leaves it
 * disabled until the user picks it under Settings > General > VPN, DNS & Device Management > DNS,
 * so `needsUserAction` is true between save and that tap. Requires the dns-settings entitlement.
 */
public class PayholeDnsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PayholeDns")

    Events("stateChanged")

    Function("isSupported") { () -> Bool in
      return true
    }

    AsyncFunction("prepare") { () -> Bool in
      return true
    }

    AsyncFunction("start") { (config: StartConfig, promise: Promise) in
      let manager = NEDNSSettingsManager.shared()
      manager.loadFromPreferences { loadError in
        if let loadError {
          promise.reject("E_LOAD", loadError.localizedDescription)
          return
        }
        let settings: NEDNSSettings
        if let dohUrl = config.dohUrl, let url = URL(string: dohUrl) {
          let https = NEDNSOverHTTPSSettings(servers: [])
          https.serverURL = url
          settings = https
        } else if let dotHost = config.dotHost {
          let tls = NEDNSOverTLSSettings(servers: [])
          tls.serverName = dotHost
          settings = tls
        } else {
          promise.reject("E_CONFIG", "A DNS-over-HTTPS URL or DNS-over-TLS host is required")
          return
        }
        manager.dnsSettings = settings
        manager.localizedDescription = config.label
        manager.saveToPreferences { saveError in
          if let saveError {
            promise.reject("E_SAVE", saveError.localizedDescription)
            return
          }
          self.sendEvent("stateChanged", self.snapshot(manager, error: nil))
          promise.resolve(nil)
        }
      }
    }

    AsyncFunction("stop") { (promise: Promise) in
      let manager = NEDNSSettingsManager.shared()
      manager.removeFromPreferences { error in
        if let error {
          promise.reject("E_REMOVE", error.localizedDescription)
          return
        }
        self.sendEvent("stateChanged", self.offState())
        promise.resolve(nil)
      }
    }

    AsyncFunction("getState") { (promise: Promise) in
      let manager = NEDNSSettingsManager.shared()
      manager.loadFromPreferences { error in
        promise.resolve(self.snapshot(manager, error: error))
      }
    }

    Function("openSettings") {
      guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
      DispatchQueue.main.async {
        UIApplication.shared.open(url)
      }
    }

    AsyncFunction("requestNotificationPermission") { () -> Bool in
      return true
    }
  }

  private func offState() -> [String: Any?] {
    return [
      "status": "off",
      "needsUserAction": false,
      "resolver": nil,
      "queries": 0,
      "blocked": 0,
      "recentBlocked": [String](),
      "error": nil,
    ]
  }

  private func snapshot(_ manager: NEDNSSettingsManager, error: Error?) -> [String: Any?] {
    if let error {
      return [
        "status": "error",
        "needsUserAction": false,
        "resolver": nil,
        "queries": 0,
        "blocked": 0,
        "recentBlocked": [String](),
        "error": error.localizedDescription,
      ]
    }
    let installed = manager.dnsSettings != nil
    var resolver: String? = nil
    if let https = manager.dnsSettings as? NEDNSOverHTTPSSettings {
      resolver = https.serverURL?.host
    } else if let tls = manager.dnsSettings as? NEDNSOverTLSSettings {
      resolver = tls.serverName
    }
    let label: String? = installed ? (manager.localizedDescription ?? resolver) : nil
    return [
      "status": installed && manager.isEnabled ? "on" : "off",
      "needsUserAction": installed && !manager.isEnabled,
      "resolver": label,
      "queries": 0,
      "blocked": 0,
      "recentBlocked": [String](),
      "error": nil,
    ]
  }
}
