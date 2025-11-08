package config

import (
    "fmt"
    "os"
    "strconv"
    "strings"
    "time"
)

type Config struct {
    DoHAddr            string
    DNSAddr            string
    MetricsAddr        string
    ControlPlaneGRPC   string
    ControlPlaneWS     string
    BlocklistPath      string
    BlocklistURLs      []string
    UpstreamAddr       string
    UpstreamTimeout    time.Duration
    RateLimitRPS       float64
    RateLimitBurst     int
    RateLimiterTTL     time.Duration
}

func FromEnv() (*Config, error) {
    cfg := &Config{
        DoHAddr:         valueOrDefault("RESOLVER_DOH_ADDR", ":8053"),
        DNSAddr:         valueOrDefault("RESOLVER_DNS_ADDR", ":53"),
        MetricsAddr:     valueOrDefault("RESOLVER_METRICS_ADDR", ":9102"),
        ControlPlaneGRPC: valueOrDefault("RESOLVER_CONTROL_PLANE_GRPC", ":9600"),
        ControlPlaneWS:  valueOrDefault("RESOLVER_CONTROL_PLANE_WS", ":9601"),
        BlocklistPath:   valueOrDefault("BLOCKLIST_PATH", "../proxy/data/blocklist.txt"),
        UpstreamAddr:    valueOrDefault("UPSTREAM_DNS_ADDR", "1.1.1.1:53"),
    }

    timeout := valueOrDefault("UPSTREAM_TIMEOUT", "5s")
    d, err := time.ParseDuration(timeout)
    if err != nil {
        return nil, fmt.Errorf("invalid UPSTREAM_TIMEOUT: %w", err)
    }
    cfg.UpstreamTimeout = d

    cfg.BlocklistURLs = parseCSV(os.Getenv("BLOCKLIST_URLS"))

    if rps := os.Getenv("RATE_LIMIT_RPS"); rps != "" {
        val, err := strconv.ParseFloat(rps, 64)
        if err != nil {
            return nil, fmt.Errorf("invalid RATE_LIMIT_RPS: %w", err)
        }
        cfg.RateLimitRPS = val
    } else {
        cfg.RateLimitRPS = 20
    }

    if burst := os.Getenv("RATE_LIMIT_BURST"); burst != "" {
        val, err := strconv.Atoi(burst)
        if err != nil {
            return nil, fmt.Errorf("invalid RATE_LIMIT_BURST: %w", err)
        }
        cfg.RateLimitBurst = val
    } else {
        cfg.RateLimitBurst = 40
    }

    ttl := valueOrDefault("RATE_LIMIT_TTL", "10m")
    ttlDur, err := time.ParseDuration(ttl)
    if err != nil {
        return nil, fmt.Errorf("invalid RATE_LIMIT_TTL: %w", err)
    }
    cfg.RateLimiterTTL = ttlDur

    return cfg, nil
}

func valueOrDefault(key, fallback string) string {
    if val := strings.TrimSpace(os.Getenv(key)); val != "" {
        return val
    }
    return fallback
}

func parseCSV(input string) []string {
    if strings.TrimSpace(input) == "" {
        return nil
    }
    parts := strings.Split(input, ",")
    result := make([]string, 0, len(parts))
    for _, part := range parts {
        trimmed := strings.TrimSpace(part)
        if trimmed != "" {
            result = append(result, trimmed)
        }
    }
    return result
}
