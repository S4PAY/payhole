package auth

import (
	"net"
	"sync"
	"time"
)

type IPCache struct {
	mu    sync.RWMutex
	items map[string]time.Time
}

func NewIPCache() *IPCache {
	return &IPCache{items: make(map[string]time.Time)}
}

func (c *IPCache) Authorize(remoteAddr string, expiry time.Time) {
	ip := extractIP(remoteAddr)
	if ip == "" {
		return
	}
	c.mu.Lock()
	c.items[ip] = expiry
	c.mu.Unlock()
}

func (c *IPCache) IsAuthorized(remoteAddr string) bool {
	ip := extractIP(remoteAddr)
	if ip == "" {
		return false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	expiry, ok := c.items[ip]
	if !ok {
		return false
	}
	if time.Now().After(expiry) {
		delete(c.items, ip)
		return false
	}
	return true
}

func extractIP(remoteAddr string) string {
	if remoteAddr == "" {
		return ""
	}
	if ip := net.ParseIP(remoteAddr); ip != nil {
		return ip.String()
	}
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}

