package filter

import "testing"

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

