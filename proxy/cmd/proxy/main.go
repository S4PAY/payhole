package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/miekg/dns"
	"github.com/skip2/go-qrcode"

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

	determineSchemeAndHost := func(r *http.Request) (string, string) {
		scheme := "https"
		if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
			scheme = forwarded
		} else if r.TLS == nil && strings.HasPrefix(r.Host, "localhost") {
			scheme = "http"
		}
		host := r.Host
		if host == "" {
			host = "localhost"
		}
		return scheme, host
	}

	resolveProxyURL := func(r *http.Request) *url.URL {
		if cfg.AutoConfigProxyURL != "" {
			if u, err := url.Parse(cfg.AutoConfigProxyURL); err == nil {
				return u
			}
			log.Printf("warning: invalid AUTOCONFIG_PROXY_URL value %q", cfg.AutoConfigProxyURL)
		}
		scheme, host := determineSchemeAndHost(r)
		return &url.URL{Scheme: scheme, Host: host}
	}

	resolveSetupURL := func(r *http.Request) string {
		if cfg.SetupDocsURL != "" {
			return cfg.SetupDocsURL
		}
		proxyURL := resolveProxyURL(r)
		return fmt.Sprintf("%s://%s/setup", proxyURL.Scheme, proxyURL.Host)
	}

	resolveDocsURL := func(r *http.Request) string {
		if cfg.SetupDocsURL != "" {
			return cfg.SetupDocsURL
		}
		proxyURL := resolveProxyURL(r)
		return fmt.Sprintf("%s://%s/docs/proxy-onboarding", proxyURL.Scheme, proxyURL.Host)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/auto-config", func(w http.ResponseWriter, r *http.Request) {
		proxyURL := resolveProxyURL(r)
		hostPort := proxyURL.Host
		if !strings.Contains(hostPort, ":") {
			if proxyURL.Scheme == "https" {
				hostPort += ":443"
			} else {
				hostPort += ":80"
			}
		}
		pac := fmt.Sprintf(`function FindProxyForURL(url, host) {
  return "HTTPS %s; DIRECT";
}
`, hostPort)
		w.Header().Set("Content-Type", "application/x-ns-proxy-autoconfig")
		_, _ = w.Write([]byte(pac))
	})

	mux.HandleFunc("/auto-config/qr", func(w http.ResponseWriter, r *http.Request) {
		setupURL := resolveSetupURL(r)
		png, err := qrcode.Encode(setupURL, qrcode.Medium, 256)
		if err != nil {
			http.Error(w, "failed to generate qr", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		if _, err := w.Write(png); err != nil {
			log.Printf("error writing qr response: %v", err)
		}
	})

	mux.HandleFunc("/setup", func(w http.ResponseWriter, r *http.Request) {
		proxyURL := resolveProxyURL(r)
		hostName := proxyURL.Hostname()
		proxyPort := proxyURL.Port()
		httpEndpoint := formatHTTPEndpoint(proxyURL.Scheme, hostName, proxyPort)
		dnsPort := extractPort(cfg.DNSProxyAddr, "5533")
		dnsEndpoint := fmt.Sprintf("%s:%s", hostName, dnsPort)
		pacURL := fmt.Sprintf("%s://%s/auto-config", proxyURL.Scheme, proxyURL.Host)
		docsURL := resolveDocsURL(r)

		setupTemplate := `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>PayHole Proxy Setup</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: radial-gradient(circle at top, #1e1b4b, #0f172a); color: #f8fafc; margin: 0; padding: 2.5rem; }
    .container { max-width: 720px; margin: 0 auto; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 24px; padding: 2.5rem; backdrop-filter: blur(18px); box-shadow: 0 25px 60px rgba(15, 23, 42, 0.45); }
    h1 { margin-top: 0; font-size: 2rem; }
    code { padding: 0.15rem 0.4rem; background: rgba(148, 163, 184, 0.16); border-radius: 8px; font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; }
    ol { padding-left: 1.25rem; }
    a { color: #a855f7; }
    .grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .card { background: rgba(30, 41, 59, 0.55); border-radius: 16px; padding: 1rem 1.25rem; border: 1px solid rgba(148, 163, 184, 0.2); }
  </style>
</head>
<body>
  <div class="container">
    <h1>Proxy onboarding unlocked</h1>
    <p>Welcome to your PayHole perimeter. Configure these endpoints on your devices to enforce the sinkhole and HTTP proxy.</p>
    <div class="grid">
      <div class="card">
        <h3>HTTP proxy</h3>
        <p><code>{{ .HTTPEndpoint }}</code></p>
      </div>
      <div class="card">
        <h3>DNS sinkhole</h3>
        <p><code>{{ .DNSEndpoint }}</code></p>
      </div>
      <div class="card">
        <h3>Auto-config script</h3>
        <p><a href="{{ .PacURL }}">{{ .PacURL }}</a></p>
      </div>
    </div>
    <h2>Platform quickstart</h2>
    <h3>Android</h3>
    <ol>
      <li>Open Settings → Network &amp; internet → Private DNS.</li>
      <li>Select Private DNS provider hostname.</li>
      <li>Enter the DNS sinkhole hostname above and save.</li>
    </ol>
    <h3>iOS</h3>
    <ol>
      <li>Install the configuration profile exposing PayHole DNS.</li>
      <li>Enable it under Settings → General → VPN &amp; Device Management.</li>
      <li>Verify Safari loads without intrusive ads.</li>
    </ol>
    <h3>macOS</h3>
    <ol>
      <li>Open System Settings → Network and edit the active service.</li>
      <li>Add the PayHole DNS servers.</li>
      <li>Configure the HTTP proxy tab with the endpoint above.</li>
    </ol>
    <h3>Windows</h3>
    <ol>
      <li>Open Settings → Network &amp; Internet → Proxy.</li>
      <li>Enable “Use a proxy server” and paste the HTTP endpoint.</li>
      <li>Update adapter DNS settings to the PayHole DNS address.</li>
    </ol>
    <p>Need deeper automation or MDM-ready profiles? Visit the <a href="{{ .DocsURL }}">proxy onboarding guide</a>.</p>
  </div>
</body>
</html>`

		data := struct {
			HTTPEndpoint string
			DNSEndpoint  string
			PacURL       string
			DocsURL      string
		}{
			HTTPEndpoint: httpEndpoint,
			DNSEndpoint:  dnsEndpoint,
			PacURL:       pacURL,
			DocsURL:      docsURL,
		}

		tmpl, err := template.New("setup").Parse(setupTemplate)
		if err != nil {
			http.Error(w, "template error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tmpl.Execute(w, data); err != nil {
			log.Printf("error rendering setup template: %v", err)
		}
	})

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
			Wallet    string `json:"wallet"`
			ExpiresAt string `json:"expiresAt"`
			ClientIP  string `json:"clientIp"`
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

func formatHTTPEndpoint(scheme, host, port string) string {
	if port == "" {
		if scheme == "https" {
			return fmt.Sprintf("%s://%s", scheme, host)
		}
		return fmt.Sprintf("%s://%s", scheme, host)
	}
	defaultPort := map[string]string{"http": "80", "https": "443"}[scheme]
	if port == defaultPort {
		return fmt.Sprintf("%s://%s", scheme, host)
	}
	return fmt.Sprintf("%s://%s:%s", scheme, host, port)
}

func extractPort(addr string, fallback string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return fallback
	}
	if strings.HasPrefix(addr, ":") {
		return strings.TrimPrefix(addr, ":")
	}
	if host, port, err := net.SplitHostPort(addr); err == nil {
		if port != "" {
			return port
		}
		if host != "" {
			return fallback
		}
	}
	if strings.Contains(addr, ",") {
		parts := strings.Split(addr, ",")
		return extractPort(strings.TrimSpace(parts[0]), fallback)
	}
	if _, err := fmt.Sscanf(addr, "%*[^:]:%s", &addr); err == nil && addr != "" {
		return addr
	}
	return fallback
}
