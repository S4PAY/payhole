package org.payhole.dns

import java.nio.ByteBuffer

/** One DNS query lifted out of the tunnel: its IPv4/UDP envelope plus the DNS message. */
class CapturedQuery(
  val srcAddr: ByteArray,
  val dstAddr: ByteArray,
  val srcPort: Int,
  val dstPort: Int,
  val message: ByteArray
)

/** IPv4/UDP framing for the DNS-only tunnel. Anything that is not UDP to port 53 is ignored. */
object DnsPacket {
  private const val PROTOCOL_UDP = 17
  private const val DNS_PORT = 53

  fun parse(packet: ByteArray, length: Int): CapturedQuery? {
    if (length < 28) return null
    val version = (packet[0].toInt() shr 4) and 0xF
    if (version != 4) return null
    val ihl = (packet[0].toInt() and 0xF) * 4
    if (ihl < 20 || length < ihl + 8) return null
    if ((packet[9].toInt() and 0xFF) != PROTOCOL_UDP) return null
    val srcPort = u16(packet, ihl)
    val dstPort = u16(packet, ihl + 2)
    if (dstPort != DNS_PORT) return null
    val udpLength = u16(packet, ihl + 4)
    if (udpLength < 8 + 12 || ihl + udpLength > length) return null
    val message = packet.copyOfRange(ihl + 8, ihl + udpLength)
    return CapturedQuery(
      srcAddr = packet.copyOfRange(12, 16),
      dstAddr = packet.copyOfRange(16, 20),
      srcPort = srcPort,
      dstPort = dstPort,
      message = message
    )
  }

  /** Wraps a DNS response in a packet addressed back to the socket that asked. */
  fun reply(query: CapturedQuery, response: ByteArray): ByteArray {
    val udpLength = 8 + response.size
    val total = 20 + udpLength
    val buffer = ByteBuffer.allocate(total)
    buffer.put(0x45.toByte()) // version 4, header length 20
    buffer.put(0) // DSCP/ECN
    buffer.putShort(total.toShort())
    buffer.putShort(0) // identification
    buffer.putShort(0x4000.toShort()) // don't fragment
    buffer.put(64) // TTL
    buffer.put(PROTOCOL_UDP.toByte())
    buffer.putShort(0) // header checksum, filled below
    buffer.put(query.dstAddr)
    buffer.put(query.srcAddr)
    buffer.putShort(query.dstPort.toShort())
    buffer.putShort(query.srcPort.toShort())
    buffer.putShort(udpLength.toShort())
    buffer.putShort(0) // UDP checksum, filled below
    buffer.put(response)

    val packet = buffer.array()
    val ipChecksum = checksum(packet, 0, 20, 0)
    packet[10] = (ipChecksum shr 8).toByte()
    packet[11] = ipChecksum.toByte()
    val udpChecksum = udpChecksum(packet, 20, udpLength)
    packet[26] = (udpChecksum shr 8).toByte()
    packet[27] = udpChecksum.toByte()
    return packet
  }

  private fun udpChecksum(packet: ByteArray, udpOffset: Int, udpLength: Int): Int {
    var pseudo = 0L
    pseudo += u16(packet, 12) + u16(packet, 14) // source address
    pseudo += u16(packet, 16) + u16(packet, 18) // destination address
    pseudo += PROTOCOL_UDP
    pseudo += udpLength
    val sum = checksum(packet, udpOffset, udpLength, pseudo)
    return if (sum == 0) 0xFFFF else sum
  }

  private fun checksum(data: ByteArray, offset: Int, length: Int, seed: Long): Int {
    var sum = seed
    var i = offset
    val end = offset + length
    while (i + 1 < end) {
      sum += u16(data, i)
      i += 2
    }
    if (i < end) sum += (data[i].toInt() and 0xFF) shl 8
    while (sum shr 16 != 0L) sum = (sum and 0xFFFF) + (sum shr 16)
    return (sum.inv() and 0xFFFF).toInt()
  }

  fun u16(bytes: ByteArray, index: Int): Int =
    ((bytes[index].toInt() and 0xFF) shl 8) or (bytes[index + 1].toInt() and 0xFF)
}
