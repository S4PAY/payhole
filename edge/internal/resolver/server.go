package resolver

import (
    "context"
    "encoding/base64"
    "errors"
    "io"
    "log"
    "net"
    "net/http"
    "strings"
    "time"

    "github.com/miekg/dns"

    "github.com/payhole/edge/internal/filter"
    "github.com/payhole/edge/internal/metrics"
    ratepkg "github.com/payhole/edge/internal/rate"
)

type Server struct {
    upstreamAddr    string
    upstreamTimeout time.Duration
    filter          *filter.Filter
    rateLimiter     *ratepkg.Limiter
    metrics         *metrics.Collector
    client          *dns.Client
}

func New(upstream string, timeout time.Duration, f *filter.Filter, limiter *ratepkg.Limiter, m *metrics.Collector) *Server {
    return &Server{
        upstreamAddr:    upstream,
        upstreamTimeout: timeout,
        filter:          f,
        rateLimiter:     limiter,
        metrics:         m,
        client:          &dns.Client{Timeout: timeout},
    }
}

func (s *Server) ServeDNS(w dns.ResponseWriter, r *dns.Msg) {
    remote := ""
    if addr := w.RemoteAddr(); addr != nil {
        remote = addr.String()
    }
    if s.rateLimiter != nil && !s.rateLimiter.Allow(clientKey(remote)) {
        if s.metrics != nil {
            s.metrics.RateLimited()
            s.metrics.ObserveQuery("rate_limited", "udp")
        }
        failure(w, r, dns.RcodeRefused)
        return
    }
    resp, result, err := s.process(r, remote, "udp")
    if err != nil {
        log.Printf("dns process error: %v", err)
        if s.metrics != nil {
            s.metrics.ObserveQuery("error", "udp")
        }
        failure(w, r, dns.RcodeServerFailure)
        return
    }
    resp.Id = r.Id
    if s.metrics != nil {
        s.metrics.ObserveQuery(result, "udp")
    }
    _ = w.WriteMsg(resp)
}

func (s *Server) DoHHandler() http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        var msg *dns.Msg
        var err error
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

        remote := r.RemoteAddr
        if s.rateLimiter != nil && !s.rateLimiter.Allow(clientKey(remote)) {
            if s.metrics != nil {
                s.metrics.RateLimited()
                s.metrics.ObserveQuery("rate_limited", "doh")
            }
            http.Error(w, "rate limited", http.StatusTooManyRequests)
            return
        }

        resp, result, err := s.process(msg, remote, "doh")
        if err != nil {
            if s.metrics != nil {
                s.metrics.ObserveQuery("error", "doh")
            }
            http.Error(w, err.Error(), http.StatusBadRequest)
            return
        }
        wire, err := resp.Pack()
        if err != nil {
            http.Error(w, "failed to serialize response", http.StatusInternalServerError)
            return
        }
        if s.metrics != nil {
            s.metrics.ObserveQuery(result, "doh")
        }
        w.Header().Set("Content-Type", "application/dns-message")
        w.WriteHeader(http.StatusOK)
        _, _ = w.Write(wire)
    })
}

func (s *Server) process(msg *dns.Msg, remoteAddr, protocol string) (*dns.Msg, string, error) {
    if len(msg.Question) == 0 {
        return nil, "error", errors.New("empty question")
    }
    domain := strings.TrimSuffix(strings.ToLower(msg.Question[0].Name), ".")
    if s.filter != nil && s.filter.ShouldBlock(domain, remoteAddr) {
        response := refused(msg)
        return response, "blocked", nil
    }

    ctx, cancel := context.WithTimeout(context.Background(), s.upstreamTimeout)
    defer cancel()

    resp, rtt, err := s.client.ExchangeContext(ctx, msg, s.upstreamAddr)
    if err != nil {
        return nil, "error", err
    }
    if s.metrics != nil {
        s.metrics.ObserveUpstream(protocol, rtt)
    }
    return resp, "allowed", nil
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

func clientKey(remote string) string {
    if remote == "" {
        return ""
    }
    host, _, err := net.SplitHostPort(remote)
    if err != nil {
        return remote
    }
    return host
}
