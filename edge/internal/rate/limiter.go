package rate

import (
    "sync"
    "time"

    golimit "golang.org/x/time/rate"
)

type Limiter struct {
    mu       sync.Mutex
    limiters map[string]*entry
    rate     golimit.Limit
    burst    int
    ttl      time.Duration
}

type entry struct {
    limiter *golimit.Limiter
    last    time.Time
}

func New(rps float64, burst int, ttl time.Duration) *Limiter {
    if rps <= 0 {
        rps = 10
    }
    if burst <= 0 {
        burst = 20
    }
    if ttl <= 0 {
        ttl = time.Minute
    }
    return &Limiter{
        limiters: make(map[string]*entry),
        rate:     golimit.Limit(rps),
        burst:    burst,
        ttl:      ttl,
    }
}

func (l *Limiter) Allow(key string) bool {
    if key == "" {
        return true
    }
    now := time.Now()

    l.mu.Lock()
    defer l.mu.Unlock()

    if ent, ok := l.limiters[key]; ok {
        ent.last = now
        return ent.limiter.Allow()
    }

    limiter := golimit.NewLimiter(golimit.Limit(l.rate), l.burst)
    l.limiters[key] = &entry{limiter: limiter, last: now}
    l.cleanupLocked(now)
    return limiter.Allow()
}

func (l *Limiter) cleanupLocked(now time.Time) {
    for k, ent := range l.limiters {
        if now.Sub(ent.last) > l.ttl {
            delete(l.limiters, k)
        }
    }
}
