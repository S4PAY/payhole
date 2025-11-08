package e2e

import (
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/miekg/dns"

	"github.com/payhole/proxy/internal/analytics"
	"github.com/payhole/proxy/internal/auth"
	"github.com/payhole/proxy/internal/blocklist"
	"github.com/payhole/proxy/internal/dnsproxy"
	"github.com/payhole/proxy/internal/httpproxy"
	"github.com/payhole/proxy/internal/policy"
	"github.com/payhole/proxy/internal/testutil"
)

func TestHTTPProxyIntegration(t *testing.T) {
	secret := "abcdefghijklmnopqrstuvwxyz1234567890abcdef"
	blocked := blocklist.New([]string{"ads.example"})
	premium := blocklist.New([]string{"premium.example"})
	entitlements := auth.NewEntitlementCache()
	authorizer, _ := auth.NewJWTAuthorizer(secret, entitlements)
	ipCache := auth.NewIPCache()
	policyEngine := policy.New(blocked, premium, authorizer, ipCache, analytics.NewClient(""))

	upstream := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/plain"}},
			Body:       http.NoBody,
		}, nil
	})

	proxyHandler := httpproxy.NewServer(policyEngine, upstream)
	server := httptest.NewServer(proxyHandler)
	t.Cleanup(server.Close)

	proxyURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("failed to parse proxy url: %v", err)
	}

	client := &http.Client{
		Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)},
	}

	resp, err := client.Get("http://ads.example/banner.js")
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for ads domain, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	resp, err = client.Get("http://premium.example/article")
	if err != nil {
		t.Fatalf("premium request failed: %v", err)
	}
	if resp.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("expected 402 for unpaid premium, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	token := testutil.MakeToken(t, secret, "wallet123", time.Hour)
	req, err := http.NewRequest(http.MethodGet, "http://premium.example/article", nil)
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("paid request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for paid request, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
}

type stubResolver struct {
	msg *dns.Msg
}

func (s *stubResolver) Resolve(*dns.Msg) (*dns.Msg, error) {
	return s.msg, nil
}

func TestDNSProxyIntegration(t *testing.T) {
	blocked := blocklist.New([]string{"ads.example"})
	premium := blocklist.New([]string{"premium.example"})
	entitlements := auth.NewEntitlementCache()
	authorizer, _ := auth.NewJWTAuthorizer("abcdefghijklmnopqrstuvwxyz1234567890abcdef", entitlements)
	ipCache := auth.NewIPCache()
	policyEngine := policy.New(blocked, premium, authorizer, ipCache, analytics.NewClient(""))

	allowed := new(dns.Msg)
	allowed.SetReply(&dns.Msg{MsgHdr: dns.MsgHdr{}})
	allowed.Rcode = dns.RcodeSuccess

	server := dnsproxy.NewServer(&stubResolver{msg: allowed}, policyEngine)

	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	dnsSrv := &dns.Server{PacketConn: conn, Handler: dns.HandlerFunc(server.ServeDNS)}
	go func() {
		if err := dnsSrv.ActivateAndServe(); err != nil {
			t.Logf("dns server stopped: %v", err)
		}
	}()
	t.Cleanup(func() {
		_ = dnsSrv.Shutdown()
		_ = conn.Close()
	})

	client := &dns.Client{}
	query := new(dns.Msg)
	query.SetQuestion("ads.example.", dns.TypeA)
	addr := conn.LocalAddr().String()

	resp, _, err := client.Exchange(query, addr)
	if err != nil {
		t.Fatalf("dns exchange failed: %v", err)
	}
	if resp.Rcode != dns.RcodeRefused {
		t.Fatalf("expected refused for ads domain, got %d", resp.Rcode)
	}

	entitlements.Grant("wallet123", time.Now().Add(time.Minute))
	ipCache.Authorize("127.0.0.1", "wallet123", time.Now().Add(time.Minute))

	premiumQuery := new(dns.Msg)
	premiumQuery.SetQuestion("premium.example.", dns.TypeA)

	resp, _, err = client.Exchange(premiumQuery, addr)
	if err != nil {
		t.Fatalf("dns exchange failed: %v", err)
	}
	if resp.Rcode != dns.RcodeSuccess {
		t.Fatalf("expected success rcode, got %d", resp.Rcode)
	}
}
