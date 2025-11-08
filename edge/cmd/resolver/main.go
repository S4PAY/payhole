package main

import (
    "errors"
    "log"
    "net/http"
    "time"

    "github.com/miekg/dns"

    "github.com/payhole/edge/internal/config"
    "github.com/payhole/edge/internal/controlplane"
    "github.com/payhole/edge/internal/filter"
    "github.com/payhole/edge/internal/metrics"
    "github.com/payhole/edge/internal/resolver"
    ratepkg "github.com/payhole/edge/internal/rate"
)

func main() {
    cfg, err := config.FromEnv()
    if err != nil {
        log.Fatalf("config error: %v", err)
    }

    blocklist, err := filter.LoadFromFile(cfg.BlocklistPath)
    if err != nil {
        log.Fatalf("failed to load blocklist: %v", err)
    }
    if err := blocklist.AppendFromURLs(cfg.BlocklistURLs); err != nil {
        log.Printf("warning: failed to append remote blocklists: %v", err)
    }

    filt := filter.New(blocklist)
    metricsCollector := metrics.New()
    limiter := ratepkg.New(cfg.RateLimitRPS, cfg.RateLimitBurst, cfg.RateLimiterTTL)

    resolverServer := resolver.New(cfg.UpstreamAddr, cfg.UpstreamTimeout, filt, limiter, metricsCollector)

    ctrl := controlplane.NewServer(filt, metricsCollector)
    if err := ctrl.RegisterGRPC(cfg.ControlPlaneGRPC); err != nil {
        log.Fatalf("grpc control plane failed: %v", err)
    }
    if err := ctrl.RegisterWebsocket(cfg.ControlPlaneWS); err != nil {
        log.Fatalf("websocket control plane failed: %v", err)
    }

    ctrl.SetMetricsGauge()
    go func() {
        ticker := time.NewTicker(1 * time.Minute)
        defer ticker.Stop()
        for range ticker.C {
            ctrl.SetMetricsGauge()
        }
    }()

    go func() {
        log.Printf("metrics listening on %s", cfg.MetricsAddr)
        if err := http.ListenAndServe(cfg.MetricsAddr, metricsCollector.Handler()); err != nil && !errors.Is(err, http.ErrServerClosed) {
            log.Fatalf("metrics server error: %v", err)
        }
    }()

    go func() {
        mux := http.NewServeMux()
        mux.Handle("/dns-query", resolverServer.DoHHandler())
        mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
            w.WriteHeader(http.StatusOK)
            _, _ = w.Write([]byte("ok"))
        })
        log.Printf("DoH listening on %s", cfg.DoHAddr)
        if err := http.ListenAndServe(cfg.DoHAddr, mux); err != nil && !errors.Is(err, http.ErrServerClosed) {
            log.Fatalf("doh server error: %v", err)
        }
    }()

    udpServer := &dns.Server{Addr: cfg.DNSAddr, Net: "udp", Handler: dns.HandlerFunc(resolverServer.ServeDNS)}
    tcpServer := &dns.Server{Addr: cfg.DNSAddr, Net: "tcp", Handler: dns.HandlerFunc(resolverServer.ServeDNS)}

    go func() {
        log.Printf("DNS (UDP) listening on %s", cfg.DNSAddr)
        if err := udpServer.ListenAndServe(); err != nil {
            log.Fatalf("dns udp error: %v", err)
        }
    }()

    log.Printf("DNS (TCP) listening on %s", cfg.DNSAddr)
    if err := tcpServer.ListenAndServe(); err != nil {
        log.Fatalf("dns tcp error: %v", err)
    }
}
