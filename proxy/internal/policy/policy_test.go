package policy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/payhole/proxy/internal/analytics"
	"github.com/payhole/proxy/internal/auth"
	"github.com/payhole/proxy/internal/blocklist"
	"github.com/payhole/proxy/internal/classifier"
)

func TestClassifierBlocksDomain(t *testing.T) {
	blocked := blocklist.New(nil)
	premium := blocklist.New(nil)
	authorizer, err := auth.NewJWTAuthorizer("12345678901234567890123456789012")
	if err != nil {
		t.Fatalf("authorizer: %v", err)
	}
	ipCache := auth.NewIPCache()
	analyticsClient := analytics.NewClient("")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"requestId":"req","score":0.92,"label":"block","modelVersion":"test"}`))
	}))
	defer server.Close()

	classifierClient := classifier.NewClientWithHTTP(server.URL, server.Client())
	pol := New(blocked, premium, authorizer, ipCache, analyticsClient, classifierClient)

	decision := pol.Decide("ads.example.com", "198.51.100.10:1234", "")
	if decision.Allow {
		t.Fatalf("expected classifier block")
	}
	if decision.Reason != ReasonModelRisk {
		t.Fatalf("expected model risk reason, got %s", decision.Reason)
	}
}
