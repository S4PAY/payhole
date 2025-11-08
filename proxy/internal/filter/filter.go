package filter

import "strings"

// Engine manages host filtering decisions across DNS and HTTP surfaces.
type Engine struct {
	blocked map[string]struct{}
}

func New(domains []string) *Engine {
	blocked := make(map[string]struct{}, len(domains))
	for _, d := range domains {
		domain := normalize(d)
		if domain != "" {
			blocked[domain] = struct{}{}
		}
	}
	return &Engine{blocked: blocked}
}

// Blocked returns true when the given domain or any of its parents are blocklisted.
func (e *Engine) Blocked(domain string) bool {
	if domain == "" {
		return false
	}
	needle := normalize(domain)
	for {
		if _, ok := e.blocked[needle]; ok {
			return true
		}
		idx := strings.Index(needle, ".")
		if idx == -1 {
			break
		}
		needle = needle[idx+1:]
	}
	return false
}

func normalize(domain string) string {
	trimmed := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domain)), ".")
	return trimmed
}

