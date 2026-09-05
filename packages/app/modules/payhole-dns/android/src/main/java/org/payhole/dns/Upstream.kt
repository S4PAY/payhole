package org.payhole.dns

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.URL
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Resolves raw DNS messages over HTTPS (RFC 8484 POST) and falls back to TLS on port 853
 * (RFC 7858). The service excludes this app from the tunnel, so these sockets reach the resolver
 * over the real network instead of looping back into the tunnel.
 */
class Upstream(private val dohUrl: String?, private val dotHost: String?) {
  private val timeoutMs = 4000
  private val dotPort = 853

  fun resolve(query: ByteArray): ByteArray {
    var failure: Exception? = null
    if (dohUrl != null) {
      try {
        return overHttps(dohUrl, query)
      } catch (e: Exception) {
        failure = e
      }
    }
    if (dotHost != null) {
      try {
        return overTls(dotHost, query)
      } catch (e: Exception) {
        failure = e
      }
    }
    throw failure ?: IllegalStateException("no resolver configured")
  }

  private fun overHttps(url: String, query: ByteArray): ByteArray {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = timeoutMs
      connection.readTimeout = timeoutMs
      connection.doOutput = true
      connection.useCaches = false
      connection.setRequestProperty("Content-Type", "application/dns-message")
      connection.setRequestProperty("Accept", "application/dns-message")
      connection.setFixedLengthStreamingMode(query.size)
      connection.outputStream.use { it.write(query) }
      val code = connection.responseCode
      if (code != 200) throw IOException("DoH answered HTTP $code")
      return connection.inputStream.use { it.readBytes() }
    } finally {
      connection.disconnect()
    }
  }

  private fun overTls(host: String, query: ByteArray): ByteArray {
    val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
    val socket = factory.createSocket() as SSLSocket
    socket.use {
      it.connect(InetSocketAddress(host, dotPort), timeoutMs)
      it.soTimeout = timeoutMs
      val parameters = it.sslParameters
      parameters.serverNames = listOf(SNIHostName(host))
      parameters.endpointIdentificationAlgorithm = "HTTPS"
      it.sslParameters = parameters
      it.startHandshake()
      val out = DataOutputStream(it.outputStream)
      out.writeShort(query.size)
      out.write(query)
      out.flush()
      val input = DataInputStream(it.inputStream)
      val length = input.readUnsignedShort()
      val response = ByteArray(length)
      input.readFully(response)
      return response
    }
  }
}
