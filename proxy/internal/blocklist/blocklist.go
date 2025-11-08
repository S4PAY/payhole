package blocklist

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type List interface {
	Contains(host string) bool
}

type Set struct {
	mu      sync.RWMutex
	domains map[string]struct{}
}

func New(entries []string) *Set {
	bl := &Set{domains: make(map[string]struct{}, len(entries))}
	for _, entry := range entries {
		entry = canonicalDomain(entry)
		if entry == "" {
			continue
		}
		bl.domains[entry] = struct{}{}
	}
	return bl
}

func LoadFromFile(path string) (*Set, error) {
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return New(nil), nil
		}
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	var entries []string
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		entries = append(entries, line)
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return New(entries), nil
}

func (s *Set) Contains(host string) bool {
	domain := canonicalDomain(host)
	if domain == "" {
		return false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for {
		if _, ok := s.domains[domain]; ok {
			return true
		}
		idx := strings.IndexByte(domain, '.')
		if idx == -1 {
			return false
		}
		domain = domain[idx+1:]
	}
}

func canonicalDomain(host string) string {
	if host == "" {
		return ""
	}
	if ip := net.ParseIP(host); ip != nil {
		return host
	}
	return strings.TrimSuffix(strings.ToLower(host), ".")
}

// Merge adds the provided domains into the blocklist.
func (s *Set) Merge(domains []string) {
	if s == nil || len(domains) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, domain := range domains {
		if d := canonicalDomain(domain); d != "" {
			s.domains[d] = struct{}{}
		}
	}
}

// AppendFromURLs downloads filter lists (e.g., EasyList) and merges them into the set.
func (s *Set) AppendFromURLs(urls []string) error {
	for _, u := range urls {
		if strings.TrimSpace(u) == "" {
			continue
		}

		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Get(u)
		if err != nil {
			return err
		}
		if resp.StatusCode >= 400 {
			_ = resp.Body.Close()
			return fmt.Errorf("failed to fetch blocklist %s: status %d", u, resp.StatusCode)
		}

		scanner := bufio.NewScanner(resp.Body)
		var domains []string
		for scanner.Scan() {
			if domain := parseFilterLine(scanner.Text()); domain != "" {
				domains = append(domains, domain)
			}
		}
		_ = resp.Body.Close()

		if err := scanner.Err(); err != nil {
			return err
		}

		s.Merge(domains)
	}
	return nil
}

func parseFilterLine(line string) string {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "!") || strings.HasPrefix(trimmed, "[") {
		return ""
	}
	if strings.HasPrefix(trimmed, "##") || strings.HasPrefix(trimmed, "@@") {
		return ""
	}
	if strings.HasPrefix(trimmed, "||") {
		trimmed = trimmed[2:]
		if idx := strings.IndexAny(trimmed, "^/"); idx != -1 {
			trimmed = trimmed[:idx]
		}
		return canonicalDomain(trimmed)
	}
	if strings.HasPrefix(trimmed, "|http") {
		trimmed = strings.TrimPrefix(trimmed, "|")
		if idx := strings.Index(trimmed, "://"); idx != -1 {
			trimmed = trimmed[idx+3:]
		}
		if idx := strings.Index(trimmed, "/"); idx != -1 {
			trimmed = trimmed[:idx]
		}
		return canonicalDomain(trimmed)
	}
	fields := strings.Fields(trimmed)
	if len(fields) >= 2 && net.ParseIP(fields[0]) != nil {
		return canonicalDomain(fields[len(fields)-1])
	}
	if net.ParseIP(trimmed) != nil {
		return ""
	}
	return canonicalDomain(trimmed)
}

