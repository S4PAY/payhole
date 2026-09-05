package org.payhole.dns

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import java.util.ArrayDeque

/**
 * Process-wide view of the tunnel, shared between the service that runs it and the module that
 * reports it to JavaScript. Lookups are counted into half-hour slices covering the last day and
 * kept in this app's private preferences, so the Home tab survives tunnel restarts and reboots.
 */
object TunnelState {
  enum class Status(val wire: String) { OFF("off"), CONNECTING("connecting"), ON("on"), ERROR("error") }

  const val BUCKET_MS = 30L * 60L * 1000L
  const val BUCKETS = 48

  private const val RECENT_LIMIT = 20
  private const val PREFS = "org.payhole.dns.stats"
  private const val KEY_HISTORY = "history"
  private const val KEY_RECENT = "recent"
  private const val PERSIST_INTERVAL_MS = 30_000L

  @Volatile var status: Status = Status.OFF
    private set
  @Volatile var resolver: String? = null
    private set
  @Volatile var error: String? = null
    private set

  private val lock = Any()
  private val bucketStart = LongArray(BUCKETS)
  private val bucketQueries = LongArray(BUCKETS)
  private val bucketBlocked = LongArray(BUCKETS)
  private val recent = ArrayDeque<String>()
  private var prefs: SharedPreferences? = null
  private var lastPersist = 0L
  private val listeners = mutableListOf<() -> Unit>()

  /** Loads what earlier sessions recorded. Safe to call from both the service and the module. */
  fun attach(context: Context) {
    synchronized(lock) {
      if (prefs != null) return
      val store = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      prefs = store
      load(store)
    }
  }

  fun update(status: Status, resolver: String?, error: String?) {
    this.status = status
    this.resolver = resolver
    this.error = error
    synchronized(lock) { persistLocked(System.currentTimeMillis()) }
    notifyListeners()
  }

  fun recordQuery(now: Long = System.currentTimeMillis()) {
    synchronized(lock) {
      bucketQueries[slotFor(now)] += 1
      if (now - lastPersist > PERSIST_INTERVAL_MS) persistLocked(now)
    }
  }

  fun recordBlocked(name: String, now: Long = System.currentTimeMillis()) {
    synchronized(lock) {
      bucketBlocked[slotFor(now)] += 1
      recent.remove(name)
      recent.addFirst(name)
      while (recent.size > RECENT_LIMIT) recent.removeLast()
      persistLocked(now)
    }
    notifyListeners()
  }

  fun snapshot(now: Long = System.currentTimeMillis()): Map<String, Any?> {
    val history = ArrayList<Map<String, Any>>(BUCKETS)
    var queries = 0L
    var blocked = 0L
    val names: List<String>
    synchronized(lock) {
      val current = now - now % BUCKET_MS
      for (age in BUCKETS - 1 downTo 0) {
        val start = current - age * BUCKET_MS
        val slot = slotIndex(start)
        val live = bucketStart[slot] == start
        val q = if (live) bucketQueries[slot] else 0L
        val b = if (live) bucketBlocked[slot] else 0L
        queries += q
        blocked += b
        history.add(mapOf("start" to start, "queries" to q, "blocked" to b))
      }
      names = recent.toList()
    }
    return mapOf(
      "status" to status.wire,
      "needsUserAction" to false,
      "resolver" to resolver,
      "queries" to queries,
      "blocked" to blocked,
      "recentBlocked" to names,
      "history" to history,
      "error" to error
    )
  }

  fun addListener(listener: () -> Unit) = synchronized(listeners) { listeners.add(listener) }

  fun removeListener(listener: () -> Unit) = synchronized(listeners) { listeners.remove(listener) }

  private fun slotIndex(start: Long): Int = ((start / BUCKET_MS) % BUCKETS).toInt()

  /** The slot for `now`, emptied first when it still holds a window from a day or more ago. */
  private fun slotFor(now: Long): Int {
    val start = now - now % BUCKET_MS
    val slot = slotIndex(start)
    if (bucketStart[slot] != start) {
      bucketStart[slot] = start
      bucketQueries[slot] = 0
      bucketBlocked[slot] = 0
    }
    return slot
  }

  private fun persistLocked(now: Long) {
    val store = prefs ?: return
    lastPersist = now
    val history = JSONArray()
    for (slot in 0 until BUCKETS) {
      if (bucketStart[slot] == 0L) continue
      history.put(JSONArray().put(bucketStart[slot]).put(bucketQueries[slot]).put(bucketBlocked[slot]))
    }
    store.edit()
      .putString(KEY_HISTORY, history.toString())
      .putString(KEY_RECENT, JSONArray(recent.toList()).toString())
      .apply()
  }

  private fun load(store: SharedPreferences) {
    runCatching {
      val history = JSONArray(store.getString(KEY_HISTORY, "[]"))
      for (index in 0 until history.length()) {
        val row = history.getJSONArray(index)
        val start = row.getLong(0)
        val slot = slotIndex(start)
        bucketStart[slot] = start
        bucketQueries[slot] = row.getLong(1)
        bucketBlocked[slot] = row.getLong(2)
      }
      val names = JSONArray(store.getString(KEY_RECENT, "[]"))
      recent.clear()
      for (index in 0 until names.length()) recent.addLast(names.getString(index))
    }
  }

  private fun notifyListeners() {
    val current = synchronized(listeners) { listeners.toList() }
    current.forEach { it() }
  }
}
