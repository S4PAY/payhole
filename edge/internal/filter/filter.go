package filter

import (
    "net"
    "strings"
    "sync"
    "time"
)

type Filter struct {
    blocklist *Set

    mu        sync.RWMutex
    premiumIP map[string]time.Time
}

func New(blocklist *Set) *Filter {
    return &Filter{
        blocklist: blocklist,
        premiumIP: make(map[string]time.Time),
    }
}

func (f *Filter) ShouldBlock(host, remoteAddr string) bool {
    if f.blocklist == nil {
        return false
    }
    domain := strings.TrimSuffix(strings.ToLower(host), ".")
    if domain == "" {
        return false
    }
    if !f.blocklist.Contains(domain) {
        return false
    }
    hostIP, _, err := net.SplitHostPort(remoteAddr)
    if err != nil {
        hostIP = remoteAddr
    }
    if hostIP == "" {
        return true
    }
    if f.isAuthorized(hostIP) {
        return false
    }
    return true
}

func (f *Filter) Authorize(ip string, expiry time.Time) {
    if ip == "" {
        return
    }
    f.mu.Lock()
    defer f.mu.Unlock()
    f.premiumIP[ip] = expiry
}

func (f *Filter) isAuthorized(ip string) bool {
    f.mu.Lock()
    defer f.mu.Unlock()

    expiry, ok := f.premiumIP[ip]
    if !ok {
        return false
    }
    if time.Now().After(expiry) {
        delete(f.premiumIP, ip)
        return false
    }
    return true
}

func (f *Filter) AuthorizedCount() int {
    f.mu.Lock()
    defer f.mu.Unlock()

    now := time.Now()
    count := 0
    for ip, expiry := range f.premiumIP {
        if now.After(expiry) {
            delete(f.premiumIP, ip)
            continue
        }
        count++
    }
    return count
}
