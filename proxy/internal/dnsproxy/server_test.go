package dnsproxy

import (
	"net"
	"testing"
	"time"

	"github.com/miekg/dns"

	"github.com/payhole/proxy/internal/analytics"
	"github.com/payhole/proxy/internal/auth"
	"github.com/payhole/proxy/internal/blocklist"
	"github.com/payhole/proxy/internal/policy"
)

type stubResolver struct {
	msg *dns.Msg
}

func (s *stubResolver) Resolve(_ *dns.Msg) (*dns.Msg, error) {
	return s.msg, nil
}

type mockWriter struct {
	msg    *dns.Msg
	remote net.Addr
}

func (m *mockWriter) WriteMsg(msg *dns.Msg) error {
	m.msg = msg
	return nil
}

func (m *mockWriter) Write([]byte) (int, error) { return 0, nil }
func (m *mockWriter) Close() error             { return nil }
func (m *mockWriter) TsigStatus() error        { return nil }
func (m *mockWriter) TsigTimersOnly(bool)      {}
func (m *mockWriter) LocalAddr() net.Addr      { return &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 5353} }
func (m *mockWriter) RemoteAddr() net.Addr     { return m.remote }

func TestDNSBlockedUnauthorized(t *testing.T) {
	blocked := blocklist.New([]string{"ads.example.com"})
	premium := blocklist.New(nil)
	authorizer, _ := auth.NewJWTAuthorizer("abcdefghijklmnopqrstuvwxyz1234567890abcdef")
	p := policy.New(blocked, premium, authorizer, auth.NewIPCache(), analytics.NewClient(""))
	server := NewServer(&stubResolver{}, p)

	msg := new(dns.Msg)
	msg.SetQuestion("ads.example.com.", dns.TypeA)

	writer := &mockWriter{remote: &net.UDPAddr{IP: net.ParseIP("203.0.113.10"), Port: 53000}}
	server.ServeDNS(writer, msg)

	if writer.msg == nil {
		t.Fatalf("expected response message")
	}

	if writer.msg.Rcode != dns.RcodeRefused {
		t.Fatalf("expected refused rcode got %d", writer.msg.Rcode)
	}
}

func TestDNSAllowsAuthorized(t *testing.T) {
	blocked := blocklist.New([]string{"premium.example.com"})
	premium := blocklist.New([]string{"premium.example.com"})
	cache := auth.NewIPCache()
	cache.Authorize("203.0.113.10", time.Now().Add(time.Hour))
	authorizer, _ := auth.NewJWTAuthorizer("abcdefghijklmnopqrstuvwxyz1234567890abcdef")
	p := policy.New(blocked, premium, authorizer, cache, analytics.NewClient(""))

	upstream := &dns.Msg{}
	upstream.SetReply(&dns.Msg{})
	upstream.Rcode = dns.RcodeSuccess

	server := NewServer(&stubResolver{msg: upstream}, p)

	query := new(dns.Msg)
	query.SetQuestion("premium.example.com.", dns.TypeA)

	writer := &mockWriter{remote: &net.UDPAddr{IP: net.ParseIP("203.0.113.10"), Port: 53000}}
	server.ServeDNS(writer, query)

	if writer.msg == nil {
		t.Fatalf("expected response message")
	}

	if writer.msg.Rcode != dns.RcodeSuccess {
		t.Fatalf("expected success rcode got %d", writer.msg.Rcode)
	}
}
