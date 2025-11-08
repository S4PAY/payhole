package filter

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/payhole/proxy/internal/blocklist"
)

// Engine manages filter list ingestion and lookup across DNS/HTTP entrypoints.
// It wraps a blocklist.Set to provide fast contains checks while handling
// EasyList/EasyPrivacy refreshes, persistence, and local overrides.
type Engine struct {
	mu              sync.RWMutex
	list            *blocklist.Set
	basePath        string
	cachePath       string
	urls            []string
	refreshInterval time.Duration
	client          *http.Client
}

// New constructs an Engine seeded with the provided domains.
func New(domains []string) *Engine {
	return &Engine{list: blocklist.New(domains)}
}

// NewWithSources loads blocklist entries from disk and remote filter lists.
func NewWithSources(basePath, cachePath string, urls []string, refreshInterval time.Duration) (*Engine, error) {
	var (
		base *blocklist.Set
		err  error
	)
	if strings.TrimSpace(basePath) == "" {
		base = blocklist.New(nil)
	} else {
		base, err = blocklist.LoadFromFile(basePath)
		if err != nil {
			return nil, err
		}
	}
	if cachePath != "" {
		cached, err := blocklist.LoadFromFile(cachePath)
		if err != nil {
			return nil, err
		}
		base.Merge(cached.Entries())
	}

	return &Engine{
		list:            base,
		basePath:        basePath,
		cachePath:       cachePath,
		urls:            urls,
		refreshInterval: refreshInterval,
		client: &http.Client{
			Timeout: 20 * time.Second,
		},
	}, nil
}

// Blocked returns true when the given domain or any parent is blocklisted.
func (e *Engine) Blocked(domain string) bool {
	if e == nil {
		return false
	}
	e.mu.RLock()
	list := e.list
	e.mu.RUnlock()
	if list == nil {
		return false
	}
	return list.Contains(domain)
}

// Contains satisfies the blocklist.List interface so the engine can be shared
// with the policy package.
func (e *Engine) Contains(domain string) bool {
	return e.Blocked(domain)
}

// List exposes the underlying blocklist for read-only consumers.
func (e *Engine) List() blocklist.List {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.list
}

// Start triggers an immediate refresh followed by periodic updates until the
// context is cancelled. Errors are reported via logf when provided.
func (e *Engine) Start(ctx context.Context, logf func(string, ...interface{})) {
	if e == nil || len(e.urls) == 0 {
		return
	}
	if err := e.refresh(ctx); err != nil && logf != nil {
		logf("filter refresh failed: %v", err)
	}
	if e.refreshInterval <= 0 {
		return
	}
	ticker := time.NewTicker(e.refreshInterval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := e.refresh(ctx); err != nil && logf != nil {
					logf("filter refresh failed: %v", err)
				}
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (e *Engine) refresh(ctx context.Context) error {
	domains := blocklist.New(nil)

	if strings.TrimSpace(e.basePath) != "" {
		base, err := blocklist.LoadFromFile(e.basePath)
		if err != nil {
			return err
		}
		domains.Merge(base.Entries())
	}

	fetched, err := e.fetchRemote(ctx)
	if err != nil {
		return err
	}
	domains.Merge(fetched)

	e.mu.Lock()
	e.list = domains
	e.mu.Unlock()

	if e.cachePath != "" {
		if err := persistDomains(e.cachePath, domains.Entries()); err != nil {
			return err
		}
	}
	return nil
}

func (e *Engine) fetchRemote(ctx context.Context) ([]string, error) {
	if len(e.urls) == 0 {
		return nil, nil
	}
	var merged []string
	for _, raw := range e.urls {
		url := strings.TrimSpace(raw)
		if url == "" {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		resp, err := e.client.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode >= 400 {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("failed to download %s: status %d", url, resp.StatusCode)
		}
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			if domain := blocklist.ParseFilterLine(scanner.Text()); domain != "" {
				merged = append(merged, domain)
			}
		}
		if err := scanner.Err(); err != nil {
			_ = resp.Body.Close()
			return nil, err
		}
		if err := resp.Body.Close(); err != nil {
			return nil, err
		}
	}
	return merged, nil
}

func persistDomains(path string, domains []string) error {
	if path == "" {
		return nil
	}
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	for _, domain := range domains {
		if strings.TrimSpace(domain) == "" {
			continue
		}
		if _, err := file.WriteString(domain + "\n"); err != nil {
			return err
		}
	}
	return nil
}
