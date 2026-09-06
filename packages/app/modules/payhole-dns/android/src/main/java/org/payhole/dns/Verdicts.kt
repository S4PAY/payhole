package org.payhole.dns

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * Asks the resolver what a blocked name is. The tunnel only sees that an answer was sunk; the category
 * comes from the resolver's public verdict endpoint, looked up once per name off the DNS path and
 * remembered. Names in the dangerous categories raise a notification, at most once per name in a while.
 */
object Verdicts {
  private const val CACHE_LIMIT = 500
  private const val NOTIFY_AGAIN_MS = 10L * 60L * 1000L
  private const val RETRY_MS = 5L * 60L * 1000L
  private val DANGEROUS = setOf("infra", "drainer", "phishing", "counterfeit")

  /** The verdict endpoint derived from the active DoH resolver, or null when the resolver has none. */
  @Volatile var baseUrl: String? = null
  @Volatile var onDangerous: ((name: String, category: String) -> Unit)? = null

  private val executor = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "payhole-verdicts").apply { isDaemon = true } }
  private val cache = object : LinkedHashMap<String, String?>(64, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String?>?): Boolean = size > CACHE_LIMIT
  }
  private val notified = HashMap<String, Long>()
  private val failedAt = HashMap<String, Long>()

  /** The category already known for `name`, or null when it has not been looked up. */
  fun cached(name: String): String? = synchronized(cache) { cache[name] }

  fun isDangerous(category: String?): Boolean = category != null && category in DANGEROUS

  /**
   * Looks the name up unless it is cached; reports the category back to the tunnel state when it arrives.
   * A lookup the resolver could not answer is tried again a few minutes later, not on every block.
   */
  fun lookup(name: String) {
    val base = baseUrl ?: return
    synchronized(cache) {
      if (cache.containsKey(name)) return
      val failed = failedAt[name]
      if (failed != null && System.currentTimeMillis() - failed < RETRY_MS) return
    }
    executor.execute {
      val category = fetchCategory(base, name)
      if (category == null) {
        synchronized(cache) { failedAt[name] = System.currentTimeMillis() }
        return@execute
      }
      synchronized(cache) {
        cache[name] = category
        failedAt.remove(name)
      }
      TunnelState.setCategory(name, category)
      if (isDangerous(category)) maybeNotify(name, category)
    }
  }

  private fun maybeNotify(name: String, category: String) {
    val now = System.currentTimeMillis()
    synchronized(notified) {
      val last = notified[name]
      if (last != null && now - last < NOTIFY_AGAIN_MS) return
      notified[name] = now
      if (notified.size > CACHE_LIMIT) notified.entries.removeAll { now - it.value > NOTIFY_AGAIN_MS }
    }
    onDangerous?.invoke(name, category)
  }

  /** The category the resolver gives, "other" when it does not consider the name blocked, null when it could not be asked. */
  private fun fetchCategory(base: String, name: String): String? {
    return try {
      val url = URL("$base?name=${URLEncoder.encode(name, "UTF-8")}")
      val connection = url.openConnection() as HttpURLConnection
      connection.connectTimeout = 4000
      connection.readTimeout = 4000
      connection.setRequestProperty("accept", "application/json")
      try {
        if (connection.responseCode != 200) return null
        val body = connection.inputStream.bufferedReader().use { it.readText() }
        val json = JSONObject(body)
        if (!json.optBoolean("blocked", false)) return "other"
        val category = json.optString("category", "")
        if (category.isEmpty() || json.isNull("category")) "other" else category
      } finally {
        connection.disconnect()
      }
    } catch (_: Exception) {
      null
    }
  }
}
