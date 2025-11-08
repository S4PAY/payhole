package filter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEngineBlocked(t *testing.T) {
	engine := New([]string{"ads.example.com", "tracking.payhole"})

	tests := []struct {
		domain string
		want   bool
	}{
		{"ads.example.com", true},
		{"sub.ads.example.com", true},
		{"tracking.payhole", true},
		{"deep.space.tracking.payhole", true},
		{"safe.example.com", false},
		{"example.com", false},
	}

	for _, tc := range tests {
		if got := engine.Blocked(tc.domain); got != tc.want {
			t.Errorf("Blocked(%q) = %v, want %v", tc.domain, got, tc.want)
		}
	}
}

func TestEngineRefresh(t *testing.T) {
	tmp := t.TempDir()
	basePath := filepath.Join(tmp, "base.txt")
	if err := os.WriteFile(basePath, []byte("local.example\n"), 0o644); err != nil {
		t.Fatalf("failed to write base list: %v", err)
	}
	cachePath := filepath.Join(tmp, "cache.txt")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("||ads.remote.com^\ntracker.remote.com\n"))
	}))
	t.Cleanup(srv.Close)

	engine, err := NewWithSources(basePath, cachePath, []string{srv.URL}, 0)
	if err != nil {
		t.Fatalf("NewWithSources failed: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	engine.Start(ctx, nil)
	cancel()

	if !engine.Blocked("ads.remote.com") {
		t.Fatalf("expected remote domain to be blocked")
	}
	if !engine.Blocked("local.example") {
		t.Fatalf("expected local domain to be preserved")
	}

	data, err := os.ReadFile(cachePath)
	if err != nil {
		t.Fatalf("failed to read cache: %v", err)
	}
	contents := string(data)
	if !strings.Contains(contents, "ads.remote.com") || !strings.Contains(contents, "local.example") {
		t.Fatalf("cache missing domains: %s", contents)
	}
}
