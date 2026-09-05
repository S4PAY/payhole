package org.payhole.dns

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * A DNS-only tunnel. The device is told to use a private address as its DNS server and only that
 * one address is routed into the tunnel, so ordinary traffic keeps its normal path while every
 * plain-text DNS query lands here and is forwarded over HTTPS or TLS.
 */
class DnsVpnService : VpnService() {
  companion object {
    const val ACTION_START = "org.payhole.dns.action.START"
    const val ACTION_STOP = "org.payhole.dns.action.STOP"
    const val EXTRA_DOH_URL = "dohUrl"
    const val EXTRA_DOT_HOST = "dotHost"
    const val EXTRA_LABEL = "label"

    private const val CHANNEL_ID = "payhole-dns"
    private const val NOTIFICATION_ID = 4663
    private const val TUNNEL_ADDRESS = "10.111.222.1"
    private const val DNS_ADDRESS = "10.111.222.2"
    private const val MTU = 1500
    private const val MAX_PACKET = 32767
  }

  private var tunnel: ParcelFileDescriptor? = null
  private var reader: Thread? = null
  private var upstream: Upstream? = null
  private val running = AtomicBoolean(false)
  private lateinit var workers: ExecutorService

  override fun onCreate() {
    super.onCreate()
    TunnelState.attach(this)
    workers = Executors.newFixedThreadPool(8)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopTunnel(TunnelState.Status.OFF, null)
      stopSelf()
      return START_NOT_STICKY
    }
    val dohUrl = intent?.getStringExtra(EXTRA_DOH_URL)
    val dotHost = intent?.getStringExtra(EXTRA_DOT_HOST)
    val label = intent?.getStringExtra(EXTRA_LABEL) ?: dotHost ?: dohUrl ?: "resolver"
    showNotification(label)
    startTunnel(dohUrl, dotHost, label)
    return START_STICKY
  }

  /** Called when the user turns the VPN off in system settings or another VPN takes over. */
  override fun onRevoke() {
    stopTunnel(TunnelState.Status.OFF, null)
    stopSelf()
  }

  override fun onDestroy() {
    stopTunnel(TunnelState.Status.OFF, null)
    workers.shutdownNow()
    super.onDestroy()
  }

  private fun startTunnel(dohUrl: String?, dotHost: String?, label: String) {
    if (running.get()) closeTunnel()
    if (dohUrl == null && dotHost == null) {
      TunnelState.update(TunnelState.Status.ERROR, label, "no resolver configured")
      return
    }
    TunnelState.update(TunnelState.Status.CONNECTING, label, null)
    try {
      val builder = Builder()
        .setSession("PayHole")
        .addAddress(TUNNEL_ADDRESS, 32)
        .addDnsServer(DNS_ADDRESS)
        .addRoute(DNS_ADDRESS, 32)
        .setMtu(MTU)
        .setBlocking(true)
      // Keep this app's own sockets out of the tunnel so the resolver can be reached directly.
      runCatching { builder.addDisallowedApplication(packageName) }
      val descriptor = builder.establish() ?: throw IllegalStateException("VPN permission was not granted")
      tunnel = descriptor
      upstream = Upstream(dohUrl, dotHost)
      running.set(true)
      reader = Thread({ pump(descriptor) }, "payhole-dns-tunnel").also { it.start() }
      TunnelState.update(TunnelState.Status.ON, label, null)
    } catch (e: Exception) {
      closeTunnel()
      TunnelState.update(TunnelState.Status.ERROR, label, e.message ?: e.javaClass.simpleName)
    }
  }

  private fun pump(descriptor: ParcelFileDescriptor) {
    val input = FileInputStream(descriptor.fileDescriptor)
    val output = FileOutputStream(descriptor.fileDescriptor)
    val buffer = ByteArray(MAX_PACKET)
    while (running.get()) {
      val length = try {
        input.read(buffer)
      } catch (_: IOException) {
        break
      }
      if (length <= 0) continue
      val query = DnsPacket.parse(buffer, length) ?: continue
      TunnelState.recordQuery()
      val resolver = upstream ?: continue
      try {
        workers.execute { answer(query, resolver, output) }
      } catch (_: Exception) {
        // The executor is shutting down; the tunnel is closing with it.
      }
    }
  }

  private fun answer(query: CapturedQuery, resolver: Upstream, output: FileOutputStream) {
    val response = try {
      resolver.resolve(query.message)
    } catch (_: Exception) {
      DnsMessage.servfail(query.message)
    }
    val summary = DnsMessage.summarize(query.message, response)
    if (summary?.blocked == true) TunnelState.recordBlocked(summary.name)
    val packet = DnsPacket.reply(query, response)
    synchronized(output) {
      try {
        output.write(packet)
      } catch (_: IOException) {
        // Tunnel closed underneath us.
      }
    }
  }

  private fun closeTunnel() {
    running.set(false)
    runCatching { tunnel?.close() }
    tunnel = null
    reader = null
    upstream = null
  }

  private fun stopTunnel(status: TunnelState.Status, error: String?) {
    closeTunnel()
    TunnelState.update(status, null, error)
    stopForeground(STOP_FOREGROUND_REMOVE)
  }

  private fun showNotification(label: String) {
    val notification = buildNotification(label)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun buildNotification(label: String): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "PayHole protection", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Shown while encrypted DNS is on"
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }

    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, flags)
    }
    val stop = PendingIntent.getService(
      this,
      1,
      Intent(this, DnsVpnService::class.java).setAction(ACTION_STOP),
      flags
    )

    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    builder
      .setSmallIcon(R.drawable.ic_payhole_dns)
      .setContentTitle("PayHole protection is on")
      .setContentText("Encrypted DNS through $label")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
    if (open != null) builder.setContentIntent(open)
    builder.addAction(Notification.Action.Builder(null, "Turn off", stop).build())
    return builder.build()
  }
}
