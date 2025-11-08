package socksproxy

import (
	"context"
	"errors"
	"net"
	"time"

	"github.com/armon/go-socks5"

	"github.com/payhole/proxy/internal/policy"
)

// Server exposes a SOCKS5 proxy that enforces PayHole policy decisions.
type Server struct {
	engine *policy.Policy
	server *socks5.Server
}

// New constructs a SOCKS proxy bound to the provided policy engine.
func New(p *policy.Policy) (*Server, error) {
	if p == nil {
		return nil, errors.New("policy is required")
	}

	dialer := &net.Dialer{Timeout: 30 * time.Second}
	cfg := &socks5.Config{
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, address)
		},
		Rules: &ruleSet{policy: p},
	}
	srv, err := socks5.New(cfg)
	if err != nil {
		return nil, err
	}
	return &Server{engine: p, server: srv}, nil
}

// ListenAndServe starts accepting SOCKS clients on addr.
func (s *Server) ListenAndServe(addr string) error {
	if s == nil || s.server == nil {
		return errors.New("socks server not initialised")
	}
	if addr == "" {
		addr = ":1080"
	}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	defer listener.Close()

	return s.server.Serve(listener)
}

type ruleSet struct {
	policy *policy.Policy
}

func (r *ruleSet) Allow(ctx context.Context, req *socks5.Request) (context.Context, bool) {
	host := req.DestAddr.FQDN
	if host == "" {
		host = req.DestAddr.Address()
	}
	remote := ""
	if req.RemoteAddr != nil {
		remote = req.RemoteAddr.Address()
	}
	decision := r.policy.Decide(host, remote, "")
	if decision.Allow {
		return ctx, true
	}
	return ctx, false
}
