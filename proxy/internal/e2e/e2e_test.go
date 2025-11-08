package e2e

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
	"github.com/payhole/proxy/internal/httpproxy"
	"github.com/payhole/proxy/internal/policy"
	"github.com/payhole/proxy/internal/testutil"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestPremiumDomainFlow(t *testing.T) {
	secret := "abcdefghijklmnopqrstuvwxyz1234567890abcdef"
	blocked := blocklist.New([]string{})
	premium := blocklist.New([]string{"premium.test"})
	authorizer, _ := auth.NewJWTAuthorizer(secret)
	ipCache := auth.NewIPCache()

	client := analytics.NewClient("")
	p := policy.New(blocked, premium, authorizer, ipCache, client)

	upstream := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader("premium content")),
			Header:     http.Header{"Content-Type": []string{"text/plain"}},
		}, nil
	})

	proxy := httpproxy.NewServer(p, upstream)

	t.Run("free user receives paywall", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "http://premium.test/article", nil)
		req.Host = "premium.test"
		req.RemoteAddr = "198.51.100.12:5432"

		resp := httptest.NewRecorder()
		proxy.ServeHTTP(resp, req)

		result := resp.Result()
		if result.StatusCode != http.StatusPaymentRequired {
			t.Fatalf("expected 402, got %d", result.StatusCode)
		}
		body, _ := io.ReadAll(result.Body)
		if !strings.Contains(string(body), "PayHole Unlock Required") {
			t.Fatalf("expected block page, got %s", string(body))
		}
	})

	t.Run("paid user allowed", func(t *testing.T) {
		token := testutil.MakeToken(t, secret, "wallet123", time.Hour)

		req := httptest.NewRequest(http.MethodGet, "http://premium.test/article", nil)
		req.Host = "premium.test"
		req.Header.Set("Authorization", "Bearer "+token)
		req.RemoteAddr = "198.51.100.12:5432"

		resp := httptest.NewRecorder()
		proxy.ServeHTTP(resp, req)

		result := resp.Result()
		if result.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", result.StatusCode)
		}
		body, _ := io.ReadAll(result.Body)
		if string(body) != "premium content" {
			t.Fatalf("unexpected upstream body: %s", string(body))
		}
	})
}
