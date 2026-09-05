package org.payhole.dns

/** Just enough DNS message parsing to name a query and notice a blocked answer. */
object DnsMessage {
  private const val TYPE_A = 1
  private const val TYPE_AAAA = 28
  private const val RCODE_SERVFAIL = 2

  class Summary(val name: String, val blocked: Boolean)

  /** The question name and whether the answer points at the unspecified address. */
  fun summarize(query: ByteArray, response: ByteArray): Summary? {
    val name = questionName(query) ?: return null
    return Summary(name, isBlocked(response))
  }

  /** A SERVFAIL for the given query: same id and question, no answers. */
  fun servfail(query: ByteArray): ByteArray {
    val end = questionEnd(query) ?: 12
    val out = query.copyOf(end)
    if (out.size < 12) return out
    out[2] = (out[2].toInt() or 0x80).toByte() // QR
    out[3] = ((out[3].toInt() and 0xF0) or RCODE_SERVFAIL).toByte()
    for (i in 6 until 12) out[i] = 0 // ANCOUNT, NSCOUNT, ARCOUNT
    return out
  }

  private fun questionName(message: ByteArray): String? {
    if (message.size < 12 || DnsPacket.u16(message, 4) < 1) return null
    return readName(message, 12)?.first
  }

  private fun questionEnd(message: ByteArray): Int? {
    if (message.size < 12) return null
    var offset = 12
    repeat(DnsPacket.u16(message, 4)) {
      val (_, next) = readName(message, offset) ?: return null
      offset = next + 4
      if (offset > message.size) return null
    }
    return offset
  }

  private fun isBlocked(message: ByteArray): Boolean {
    if (message.size < 12) return false
    val qdcount = DnsPacket.u16(message, 4)
    val ancount = DnsPacket.u16(message, 6)
    var offset = 12
    repeat(qdcount) {
      val (_, next) = readName(message, offset) ?: return false
      offset = next + 4
    }
    repeat(ancount) {
      val (_, next) = readName(message, offset) ?: return false
      if (next + 10 > message.size) return false
      val type = DnsPacket.u16(message, next)
      val rdlength = DnsPacket.u16(message, next + 8)
      val data = next + 10
      if (data + rdlength > message.size) return false
      if (type == TYPE_A && rdlength == 4 && allZero(message, data, 4)) return true
      if (type == TYPE_AAAA && rdlength == 16 && allZero(message, data, 16)) return true
      offset = data + rdlength
    }
    return false
  }

  private fun allZero(bytes: ByteArray, offset: Int, length: Int): Boolean {
    for (i in offset until offset + length) if (bytes[i].toInt() != 0) return false
    return true
  }

  /** Reads a possibly compressed name; returns it with the offset just past it in the stream. */
  private fun readName(message: ByteArray, start: Int): Pair<String, Int>? {
    val labels = mutableListOf<String>()
    var offset = start
    var next = -1
    var hops = 0
    while (true) {
      if (offset >= message.size) return null
      val len = message[offset].toInt() and 0xFF
      if (len == 0) {
        offset += 1
        break
      }
      if (len and 0xC0 == 0xC0) {
        if (offset + 1 >= message.size) return null
        val pointer = ((len and 0x3F) shl 8) or (message[offset + 1].toInt() and 0xFF)
        if (pointer >= offset || ++hops > 32) return null
        if (next < 0) next = offset + 2
        offset = pointer
        continue
      }
      if (len and 0xC0 != 0) return null
      if (offset + 1 + len > message.size) return null
      labels.add(String(message, offset + 1, len, Charsets.ISO_8859_1))
      offset += 1 + len
    }
    return labels.joinToString(".") to (if (next < 0) offset else next)
  }
}
