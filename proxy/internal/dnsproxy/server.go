package dnsproxy

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/miekg/dns"

	"github.com/payhole/proxy/internal/policy"
)

// Resolver performs upstream DNS lookups.
type Resolver interface {
	Resolve(msg *dns.Msg) (*dns.Msg, error)
}

// UpstreamResolver queries a remote DNS server.
type UpstreamResolver struct {
	client  *dns.Client
	address string
}

// NewUpstreamResolver constructs a resolver pointed at address.
func NewUpstreamResolver(address string, timeout time.Duration) *UpstreamResolver {
	return &UpstreamResolver{
		client:  &dns.Client{Timeout: timeout},
		address: address,
	}
}

// Resolve performs the DNS exchange.
func (u *UpstreamResolver) Resolve(msg *dns.Msg) (*dns.Msg, error) {
	resp, _, err := u.client.Exchange(msg, u.address)
	return resp, err
}

// Server resolves DNS queries with PayHole policy enforcement.
type Server struct {
	resolver Resolver
	policy   *policy.Policy
}

// NewServer builds a DNS server.
func NewServer(resolver Resolver, p *policy.Policy) *Server {
	return &Server{
		resolver: resolver,
		policy:   p,
	}
}

// ServeDNS handles UDP/TCP DNS messages.
func (s *Server) ServeDNS(w dns.ResponseWriter, r *dns.Msg) {
	resp, err := s.process(r, w.RemoteAddr().String(), "")
	if err != nil {
		failure(w, r, dns.RcodeServerFailure)
		return
	}
	resp.Id = r.Id
	_ = w.WriteMsg(resp)
}

// DoHHandler returns an http.Handler that serves RFC 8484 DNS over HTTPS.
func (s *Server) DoHHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var (
			msg *dns.Msg
			err error
		)

		switch r.Method {
		case http.MethodGet:
			query := r.URL.Query().Get("dns")
			if query == "" {
				http.Error(w, "missing dns query", http.StatusBadRequest)
				return
			}
			raw, decodeErr := base64.RawURLEncoding.DecodeString(query)
			if decodeErr != nil {
				http.Error(w, "invalid dns query encoding", http.StatusBadRequest)
				return
			}
			msg = &dns.Msg{}
			if err = msg.Unpack(raw); err != nil {
				http.Error(w, "invalid dns message", http.StatusBadRequest)
				return
			}
		case http.MethodPost:
			body, readErr := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<16))
			if readErr != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			msg = &dns.Msg{}
			if err = msg.Unpack(body); err != nil {
				http.Error(w, "invalid dns message", http.StatusBadRequest)
				return
			}
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		resp, procErr := s.process(msg, r.RemoteAddr, r.Header.Get("Authorization"))
		if procErr != nil {
			http.Error(w, procErr.Error(), http.StatusBadRequest)
			return
		}

		wire, err := resp.Pack()
		if err != nil {
			http.Error(w, "failed to serialize response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/dns-message")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(wire)
	})
}

func (s *Server) process(msg *dns.Msg, remoteAddr, authHeader string) (*dns.Msg, error) {
	if len(msg.Question) == 0 {
		return nil, errors.New("empty question")
	}

	domain := strings.TrimSuffix(strings.ToLower(msg.Question[0].Name), ".")
	decision := s.policy.Decide(domain, remoteAddr, authHeader)
	if !decision.Allow {
		return refused(msg), nil
	}

	upstream, err := s.resolver.Resolve(msg)
	if err != nil {
		return nil, err
	}
	return upstream, nil
}

func refused(query *dns.Msg) *dns.Msg {
	response := new(dns.Msg)
	response.SetReply(query)
	response.Authoritative = true
	response.Rcode = dns.RcodeRefused
	return response
}

func failure(w dns.ResponseWriter, r *dns.Msg, code int) {
	resp := new(dns.Msg)
	resp.SetReply(r)
	resp.Rcode = code
	_ = w.WriteMsg(resp)
}
