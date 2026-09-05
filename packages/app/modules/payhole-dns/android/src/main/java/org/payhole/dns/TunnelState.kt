package org.payhole.dns

import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicLong

/**
 * Process-wide view of the tunnel, shared between the service that runs it and the module that
 * reports it to JavaScript. Counters reset whenever the tunnel starts.
 */
object TunnelState {
  enum class Status(val wire: String) { OFF("off"), CONNECTING("connecting"), ON("on"), ERROR("error") }

  private const val RECENT_LIMIT = 20

  @Volatile var status: Status = Status.OFF
    private set
  @Volatile var resolver: String? = null
    private set
  @Volatile var error: String? = null
    private set

  val queries = AtomicLong(0)
  val blocked = AtomicLong(0)

  private val recent = ArrayDeque<String>()
  private val listeners = mutableListOf<() -> Unit>()

  fun update(status: Status, resolver: String?, error: String?) {
    this.status = status
    this.resolver = resolver
    this.error = error
    notifyListeners()
  }

  fun resetCounters() {
    queries.set(0)
    blocked.set(0)
    synchronized(recent) { recent.clear() }
  }

  fun recordBlocked(name: String) {
    blocked.incrementAndGet()
    synchronized(recent) {
      recent.remove(name)
      recent.addFirst(name)
      while (recent.size > RECENT_LIMIT) recent.removeLast()
    }
    notifyListeners()
  }

  fun snapshot(): Map<String, Any?> = mapOf(
    "status" to status.wire,
    "needsUserAction" to false,
    "resolver" to resolver,
    "queries" to queries.get(),
    "blocked" to blocked.get(),
    "recentBlocked" to synchronized(recent) { recent.toList() },
    "error" to error
  )

  fun addListener(listener: () -> Unit) = synchronized(listeners) { listeners.add(listener) }

  fun removeListener(listener: () -> Unit) = synchronized(listeners) { listeners.remove(listener) }

  private fun notifyListeners() {
    val current = synchronized(listeners) { listeners.toList() }
    current.forEach { it() }
  }
}
