package httpproxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/payhole/proxy/internal/analytics"
	"github.com/payhole/proxy/internal/auth"
	"github.com/payhole/proxy/internal/blocklist"
	"github.com/payhole/proxy/internal/policy"
	"github.com/payhole/proxy/internal/testutil"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestProxyBlocksPremiumWithoutToken(t *testing.T) {
	blocked := blocklist.New([]string{})
	premium := blocklist.New([]string{"premium.example.com"})
	entitlements := auth.NewEntitlementCache()
	authorizer, _ := auth.NewJWTAuthorizer("abcdefghijklmnopqrstuvwxyz1234567890abcdef", entitlements)
	ipCache := auth.NewIPCache()
	p := policy.New(blocked, premium, authorizer, ipCache, analytics.NewClient(""))
	proxy := NewServer(p, nil)

	req := httptest.NewRequest(http.MethodGet, "http://premium.example.com/article", nil)
	req.RemoteAddr = "203.0.113.10:12345"

	resp := httptest.NewRecorder()
	proxy.ServeHTTP(resp, req)

	result := resp.Result()
	if result.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("expected 402, got %d", result.StatusCode)
	}
	body, _ := io.ReadAll(result.Body)
	if !strings.Contains(string(body), "PayHole Unlock Required") {
		t.Fatalf("expected block page HTML, got %s", string(body))
	}
}

func TestProxyAllowsPremiumWithValidToken(t *testing.T) {
	blocked := blocklist.New([]string{})
	premium := blocklist.New([]string{"premium.example.com"})
	secret := "abcdefghijklmnopqrstuvwxyz1234567890abcdef"
	entitlements := auth.NewEntitlementCache()
	authorizer, _ := auth.NewJWTAuthorizer(secret, entitlements)
	ipCache := auth.NewIPCache()
	p := policy.New(blocked, premium, authorizer, ipCache, analytics.NewClient(""))

	var forwardedAuth string
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		forwardedAuth = r.Header.Get("Authorization")
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader("ok")),
			Header:     http.Header{"Content-Type": []string{"text/plain"}},
		}, nil
	})

	proxy := NewServer(p, transport)

	req := httptest.NewRequest(http.MethodGet, "http://premium.example.com/article", nil)
	token := testutil.MakeToken(t, secret, "wallet123", time.Hour)
	req.Header.Set("Authorization", "Bearer "+token)
	req.RemoteAddr = "203.0.113.10:12345"

	resp := httptest.NewRecorder()
	proxy.ServeHTTP(resp, req)

	if resp.Result().StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Result().StatusCode)
	}
	if forwardedAuth != "" {
		t.Fatalf("expected Authorization header stripped, got %s", forwardedAuth)
	}
}
