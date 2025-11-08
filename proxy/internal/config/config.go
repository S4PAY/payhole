package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

// Config represents proxy runtime configuration.
type Config struct {
	HTTPProxyAddr            string
	DoHAddr                  string
	DNSProxyAddr             string
	SocksProxyAddr           string
	UpstreamDNS              string
	BlocklistPath            string
	BlocklistCachePath       string
	BlocklistURLs            []string
	PremiumDomains           []string
	JWTSecret                string
	AnalyticsURL             string
	UpstreamTimeout          time.Duration
	BlocklistRefreshInterval time.Duration
}

// FromEnv loads configuration from environment variables.
func FromEnv() (Config, error) {
	timeout := 3 * time.Second
	if raw := os.Getenv("UPSTREAM_TIMEOUT_SECONDS"); raw != "" {
		if parsed, err := time.ParseDuration(raw + "s"); err == nil {
			timeout = parsed
		}
	}

	refresh := 12 * time.Hour
	if raw := os.Getenv("BLOCKLIST_REFRESH_INTERVAL"); raw != "" {
		if parsed, err := time.ParseDuration(raw); err == nil {
			refresh = parsed
		}
	}

	cfg := Config{
		HTTPProxyAddr:            valueOrDefault("HTTP_PROXY_ADDR", ":8080"),
		DoHAddr:                  valueOrDefault("DOH_ADDR", ":8443"),
		DNSProxyAddr:             valueOrDefault("DNS_PROXY_ADDR", ":5353"),
		SocksProxyAddr:           valueOrDefault("SOCKS_PROXY_ADDR", ":1080"),
		UpstreamDNS:              valueOrDefault("UPSTREAM_DNS_ADDR", "1.1.1.1:53"),
		BlocklistPath:            valueOrDefault("BLOCKLIST_PATH", "data/blocklist.txt"),
		BlocklistCachePath:       valueOrDefault("BLOCKLIST_CACHE_PATH", "data/blocklist.cache"),
		BlocklistURLs:            splitList(os.Getenv("BLOCKLIST_URLS")),
		PremiumDomains:           splitList(os.Getenv("PREMIUM_DOMAINS")),
		JWTSecret:                os.Getenv("PAYMENTS_JWT_SECRET"),
		AnalyticsURL:             os.Getenv("ANALYTICS_URL"),
		UpstreamTimeout:          timeout,
		BlocklistRefreshInterval: refresh,
	}

	if len(cfg.BlocklistURLs) == 0 {
		cfg.BlocklistURLs = []string{
			"https://easylist-downloads.adblockplus.org/easylist.txt",
			"https://easylist-downloads.adblockplus.org/easyprivacy.txt",
		}
	}

	if len(cfg.PremiumDomains) == 0 {
		cfg.PremiumDomains = []string{
			"premium.payhole.news",
			"exclusive.payhole.media",
		}
	}

	if cfg.JWTSecret == "" {
		return Config{}, errors.New("PAYMENTS_JWT_SECRET is required")
	}

	if cfg.HTTPProxyAddr == cfg.DNSProxyAddr {
		return Config{}, fmt.Errorf("HTTP_PROXY_ADDR (%s) and DNS_PROXY_ADDR cannot match", cfg.HTTPProxyAddr)
	}

	return cfg, nil
}

func valueOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func splitList(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
