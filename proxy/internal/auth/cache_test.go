package auth

import (
	"testing"
	"time"
)

func TestIPCacheAuthorize(t *testing.T) {
	cache := NewIPCache()
	cache.Authorize("192.168.0.10:1234", "wallet123", time.Now().Add(time.Minute))

	ent, ok := cache.Lookup("192.168.0.10:5555")
	if !ok || ent.Wallet != "wallet123" {
		t.Fatalf("expected wallet to be cached, got %+v", ent)
	}

	cache.Authorize("10.0.0.1", "wallet456", time.Now().Add(-time.Minute))
	if _, ok := cache.Lookup("10.0.0.1"); ok {
		t.Fatalf("expired ip should not be returned")
	}

	cache.Purge() // ensure purge runs without panicking on empty cache
}

func TestEntitlementCache(t *testing.T) {
	entitlements := NewEntitlementCache()
	expiry := time.Now().Add(2 * time.Minute)
	entitlements.Grant("wallet123", expiry)

	if !entitlements.Authorized("wallet123") {
		t.Fatalf("wallet should be authorized")
	}

	got, ok := entitlements.Expiry("wallet123")
	if !ok || got.IsZero() {
		t.Fatalf("expected expiry for wallet")
	}

	entitlements.Grant("wallet123", time.Now().Add(-time.Minute))
	if entitlements.Authorized("wallet123") {
		t.Fatalf("expired wallet should not be authorized")
	}
}
