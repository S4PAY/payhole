package metrics

import (
    "net/http"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

type Collector struct {
    queries      *prometheus.CounterVec
    rateLimited  prometheus.Counter
    premiumGauge prometheus.Gauge
    upstreamHist *prometheus.HistogramVec
}

func New() *Collector {
    c := &Collector{
        queries: prometheus.NewCounterVec(prometheus.CounterOpts{
            Name: "resolver_dns_queries_total",
            Help: "Total DNS queries processed by result and protocol.",
        }, []string{"result", "protocol"}),
        rateLimited: prometheus.NewCounter(prometheus.CounterOpts{
            Name: "resolver_dns_rate_limited_total",
            Help: "Count of DNS queries rejected due to rate limiting.",
        }),
        premiumGauge: prometheus.NewGauge(prometheus.GaugeOpts{
            Name: "resolver_premium_sessions",
            Help: "Number of active premium unlock sessions.",
        }),
        upstreamHist: prometheus.NewHistogramVec(prometheus.HistogramOpts{
            Name:    "resolver_upstream_duration_seconds",
            Help:    "Duration spent resolving queries upstream.",
            Buckets: prometheus.DefBuckets,
        }, []string{"protocol"}),
    }

    prometheus.MustRegister(c.queries, c.rateLimited, c.premiumGauge, c.upstreamHist)
    return c
}

func (c *Collector) ObserveQuery(result, protocol string) {
    c.queries.WithLabelValues(result, protocol).Inc()
}

func (c *Collector) RateLimited() {
    c.rateLimited.Inc()
}

func (c *Collector) SetPremiumSessions(n int) {
    c.premiumGauge.Set(float64(n))
}

func (c *Collector) ObserveUpstream(protocol string, d time.Duration) {
    c.upstreamHist.WithLabelValues(protocol).Observe(d.Seconds())
}

func (c *Collector) Handler() http.Handler {
    return promhttp.Handler()
}
