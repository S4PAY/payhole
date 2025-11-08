package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/miekg/dns"

	"github.com/payhole/proxy/internal/analytics"
	"github.com/payhole/proxy/internal/auth"
	"github.com/payhole/proxy/internal/blocklist"
	"github.com/payhole/proxy/internal/config"
	"github.com/payhole/proxy/internal/dnsproxy"
	"github.com/payhole/proxy/internal/httpproxy"
	"github.com/payhole/proxy/internal/policy"
)

func main() {
	cfg, err := config.FromEnv()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	blockedDomains, err := blocklist.LoadFromFile(cfg.BlocklistPath)
	if err != nil {
		log.Fatalf("failed to load blocklist: %v", err)
	}
	if err := blockedDomains.AppendFromURLs(cfg.BlocklistURLs); err != nil {
		log.Printf("warning: failed to load remote blocklists: %v", err)
	}

	premiumDomains := blocklist.New(cfg.PremiumDomains)

	jwtAuthorizer, err := auth.NewJWTAuthorizer(cfg.JWTSecret)
	if err != nil {
		log.Fatalf("auth init failed: %v", err)
	}

	ipCache := auth.NewIPCache()
	analyticsClient := analytics.NewClient(cfg.AnalyticsURL)

	policyEngine := policy.New(blockedDomains, premiumDomains, jwtAuthorizer, ipCache, analyticsClient)

	httpProxy := httpproxy.NewServer(policyEngine, nil)

	resolver := dnsproxy.NewUpstreamResolver(cfg.UpstreamDNS, cfg.UpstreamTimeout)
	dnsServer := dnsproxy.NewServer(resolver, policyEngine)

	mux := http.NewServeMux()
	mux.Handle("/", httpProxy)
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/webhooks/unlock", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var payload struct {
			Wallet   string `json:"wallet"`
			ExpiresAt string `json:"expiresAt"`
			ClientIP string `json:"clientIp"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}
		if payload.ClientIP != "" && ipCache != nil {
			remote := payload.ClientIP
			if !strings.Contains(remote, ":") {
				remote = remote + ":0"
			}
			expiry := time.Now().Add(30 * time.Second)
			if ts, err := time.Parse(time.RFC3339, payload.ExpiresAt); err == nil && ts.Before(expiry) {
				expiry = ts
			}
			ipCache.Authorize(remote, expiry)
		}
		w.WriteHeader(http.StatusAccepted)
	})
	if cfg.DoHAddr == cfg.HTTPProxyAddr {
		mux.Handle("/dns-query", dnsServer.DoHHandler())
	}

	httpSrv := &http.Server{
		Addr:         cfg.HTTPProxyAddr,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("HTTP proxy listening on %s", cfg.HTTPProxyAddr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http proxy error: %v", err)
		}
	}()

	if cfg.DoHAddr != cfg.HTTPProxyAddr {
		go func() {
			log.Printf("DoH endpoint listening on %s", cfg.DoHAddr)
			if err := http.ListenAndServe(cfg.DoHAddr, dnsServer.DoHHandler()); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Fatalf("doh server error: %v", err)
			}
		}()
	}

	udpSrv := &dns.Server{Addr: cfg.DNSProxyAddr, Net: "udp", Handler: dns.HandlerFunc(dnsServer.ServeDNS)}
	tcpSrv := &dns.Server{Addr: cfg.DNSProxyAddr, Net: "tcp", Handler: dns.HandlerFunc(dnsServer.ServeDNS)}

	go func() {
		log.Printf("DNS proxy (udp) listening on %s", cfg.DNSProxyAddr)
		if err := udpSrv.ListenAndServe(); err != nil {
			log.Fatalf("dns udp error: %v", err)
		}
	}()

	log.Printf("DNS proxy (tcp) listening on %s", cfg.DNSProxyAddr)
	if err := tcpSrv.ListenAndServe(); err != nil {
		log.Fatalf("dns tcp error: %v", err)
	}
}