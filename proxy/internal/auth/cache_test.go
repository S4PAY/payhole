package auth

import (
	"testing"
	"time"
)

func TestIPCacheAuthorize(t *testing.T) {
	cache := NewIPCache()
	cache.Authorize("192.168.0.10:1234", time.Now().Add(time.Minute))

	if !cache.IsAuthorized("192.168.0.10:5555") {
		t.Fatalf("expected ip to be authorized")
	}

	time.Sleep(10 * time.Millisecond)
	cache.Authorize("10.0.0.1", time.Now().Add(-time.Minute))

	if cache.IsAuthorized("10.0.0.1") {
		t.Fatalf("expired ip should not be authorized")
	}
}

