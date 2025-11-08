package blocklist

import "testing"

func TestContainsMatchesSubdomains(t *testing.T) {
	bl := New([]string{"ads.example.com", "tracker.com"})

	if !bl.Contains("ads.example.com") {
		t.Fatalf("expected direct match")
	}

	if !bl.Contains("video.ads.example.com") {
		t.Fatalf("expected subdomain match")
	}

	if bl.Contains("news.example.com") {
		t.Fatalf("did not expect unrelated domain to match")
	}

	if !bl.Contains("tracker.com") {
		t.Fatalf("expected tracker.com match")
	}
}

