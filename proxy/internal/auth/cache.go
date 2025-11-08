package auth

import (
	"net"
	"sync"
	"time"
)

// IPEntitlement captures the wallet bound to an IP address for a limited period.
type IPEntitlement struct {
	Wallet string
	Expiry time.Time
}

// IPCache stores temporary authorisations keyed by client IP to reduce token usage.
type IPCache struct {
	mu    sync.RWMutex
	items map[string]IPEntitlement
}

func NewIPCache() *IPCache {
	return &IPCache{items: make(map[string]IPEntitlement)}
}

// Authorize associates the provided wallet with the remote address until expiry.
func (c *IPCache) Authorize(remoteAddr, wallet string, expiry time.Time) {
	ip := extractIP(remoteAddr)
	if ip == "" || wallet == "" {
		return
	}
	c.mu.Lock()
	c.items[ip] = IPEntitlement{Wallet: wallet, Expiry: expiry}
	c.mu.Unlock()
}

// Lookup returns the wallet cached for the remote address when still valid.
func (c *IPCache) Lookup(remoteAddr string) (IPEntitlement, bool) {
	ip := extractIP(remoteAddr)
	if ip == "" {
		return IPEntitlement{}, false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	entitlement, ok := c.items[ip]
	if !ok {
		return IPEntitlement{}, false
	}
	if time.Now().After(entitlement.Expiry) {
		delete(c.items, ip)
		return IPEntitlement{}, false
	}
	return entitlement, true
}

// Purge removes expired items and keeps the cache tidy.
func (c *IPCache) Purge() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for ip, ent := range c.items {
		if now.After(ent.Expiry) {
			delete(c.items, ip)
		}
	}
}

// EntitlementCache holds wallet authorisations for their unlock duration.
type EntitlementCache struct {
	mu      sync.RWMutex
	entries map[string]time.Time
}

func NewEntitlementCache() *EntitlementCache {
	return &EntitlementCache{entries: make(map[string]time.Time)}
}

// Grant records an entitlement for the specified wallet.
func (c *EntitlementCache) Grant(wallet string, expiry time.Time) {
	if wallet == "" {
		return
	}
	c.mu.Lock()
	c.entries[wallet] = expiry
	c.mu.Unlock()
}

// Authorized returns true when the wallet has an active entitlement.
func (c *EntitlementCache) Authorized(wallet string) bool {
	if wallet == "" {
		return false
	}
	c.mu.RLock()
	expiry, ok := c.entries[wallet]
	c.mu.RUnlock()
	if !ok {
		return false
	}
	if time.Now().After(expiry) {
		c.mu.Lock()
		delete(c.entries, wallet)
		c.mu.Unlock()
		return false
	}
	return true
}

// Expiry retrieves the entitlement expiry for the wallet when present.
func (c *EntitlementCache) Expiry(wallet string) (time.Time, bool) {
	if wallet == "" {
		return time.Time{}, false
	}
	c.mu.RLock()
	expiry, ok := c.entries[wallet]
	c.mu.RUnlock()
	if !ok || time.Now().After(expiry) {
		return time.Time{}, false
	}
	return expiry, true
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
