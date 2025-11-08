package httpproxy

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/skip2/go-qrcode"

	"github.com/payhole/proxy/internal/policy"
)

// Server implements an HTTP proxy with premium enforcement.
type Server struct {
	transport http.RoundTripper
	policy    *policy.Policy
}

// NewServer constructs a Server with an optional custom transport.
func NewServer(p *policy.Policy, transport http.RoundTripper) *Server {
	if transport == nil {
		transport = http.DefaultTransport
	}
	return &Server{
		transport: transport,
		policy:    p,
	}
}

// ServeHTTP enforces PayHole policy before forwarding requests upstream.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		http.Error(w, "CONNECT not supported", http.StatusNotImplemented)
		return
	}

	handler := PremiumMiddleware(s.policy, http.HandlerFunc(s.forward))
	handler.ServeHTTP(w, r)
}

func (s *Server) forward(w http.ResponseWriter, r *http.Request) {
	host := targetHost(r)
	if host == "" {
		http.Error(w, "missing host", http.StatusBadRequest)
		return
	}

	req := r.Clone(r.Context())
	req.RequestURI = ""
	prepareForwardRequest(req)

	resp, err := s.transport.RoundTrip(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	_, copyErr := io.Copy(w, resp.Body)
	if copyErr != nil && !errors.Is(copyErr, context.Canceled) {
		// swallow copy errors to keep the proxy resilient
	}
}

// PremiumMiddleware enforces premium unlock requirements before allowing traffic to continue.
func PremiumMiddleware(p *policy.Policy, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if next == nil {
			http.Error(w, "no handler configured", http.StatusInternalServerError)
			return
		}

		host := targetHost(r)
		if host == "" {
			http.Error(w, "missing host", http.StatusBadRequest)
			return
		}

		decision := p.Decide(host, r.RemoteAddr, r.Header.Get("Authorization"))
		if !decision.Allow {
			switch decision.Reason {
			case policy.ReasonPremiumPayment:
				respondPremiumRequired(w, host, r.URL.String())
			case policy.ReasonAdBlocked:
				http.Error(w, "blocked by PayHole filter", http.StatusForbidden)
			default:
				http.Error(w, "request blocked", http.StatusForbidden)
			}
			return
		}

		next.ServeHTTP(w, r)
	})
}

func targetHost(r *http.Request) string {
	host := r.URL.Hostname()
	if host != "" {
		return host
	}
	if r.Host != "" {
		if h, _, err := net.SplitHostPort(r.Host); err == nil {
			return h
		}
		return r.Host
	}
	return ""
}

func prepareForwardRequest(r *http.Request) {
	r.Header.Del("Authorization")
	r.Header.Del("Proxy-Authorization")

	if r.ContentLength == 0 {
		r.Body = nil
	}

	if r.URL.Scheme == "" {
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			r.URL.Scheme = "ws"
		} else {
			r.URL.Scheme = "http"
		}
	}

	if r.URL.Host == "" {
		r.URL.Host = r.Host
	}

	if clientIP, _, err := net.SplitHostPort(r.RemoteAddr); err == nil && clientIP != "" {
		prior := r.Header.Get("X-Forwarded-For")
		if prior == "" {
			r.Header.Set("X-Forwarded-For", clientIP)
		} else {
			r.Header.Set("X-Forwarded-For", prior+", "+clientIP)
		}
	}
}

func copyHeaders(dst, src http.Header) {
	for k, values := range src {
		for _, v := range values {
			dst.Add(k, v)
		}
	}
}

func respondPremiumRequired(w http.ResponseWriter, host, requestURL string) {
	payURL := fmt.Sprintf("https://payhole.app/pay?domain=%s", url.QueryEscape(host))
	phantomURL := fmt.Sprintf("https://phantom.app/ul/browse/%s", url.QueryEscape(payURL))
	solflareURL := fmt.Sprintf("https://solflare.com/provider?url=%s", url.QueryEscape(payURL))

	qr, err := qrcode.New(payURL, qrcode.Medium)
	if err != nil {
		http.Error(w, "payment required", http.StatusPaymentRequired)
		return
	}
	qrBytes, err := qr.PNG(180)
	if err != nil {
		http.Error(w, "payment required", http.StatusPaymentRequired)
		return
	}
	qrDataURI := "data:image/png;base64," + base64.StdEncoding.EncodeToString(qrBytes)

	tmpl := template.Must(template.New("blockpage").Parse(blockPageTemplate))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusPaymentRequired)
	data := map[string]string{
		"Host":        host,
		"RequestURL":  requestURL,
		"PayURL":      payURL,
		"QRDataURI":   qrDataURI,
		"PhantomURL":  phantomURL,
		"SolflareURL": solflareURL,
	}
	_ = tmpl.Execute(w, data)
}

const blockPageTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>PayHole Unlock Required</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    main { background: rgba(15, 23, 42, 0.85); padding: 2.5rem; border-radius: 1rem; max-width: 560px; width: 100%; box-shadow: 0 25px 50px -12px rgba(56, 189, 248, 0.25); backdrop-filter: blur(12px); }
    h1 { margin: 0 0 0.5rem; font-size: 2rem; font-weight: 600; color: #38bdf8; }
    p { line-height: 1.6; }
    .card { margin-top: 1.5rem; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; }
    .actions { display: flex; flex-direction: column; gap: 0.75rem; }
    a.button { display: inline-flex; align-items: center; justify-content: center; padding: 0.75rem 1.2rem; border-radius: 0.75rem; font-weight: 600; text-decoration: none; }
    a.primary { background: linear-gradient(135deg, #0ea5e9, #6366f1); color: #0b1120; }
    a.secondary { background: rgba(14, 165, 233, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); }
    figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 0.75rem; }
    img { border-radius: 0.75rem; background: #020617; padding: 0.75rem; }
    code { background: rgba(14, 165, 233, 0.12); padding: 0.2rem 0.4rem; border-radius: 0.4rem; font-size: 0.85rem; }
    footer { margin-top: 1.5rem; font-size: 0.85rem; color: rgba(226, 232, 240, 0.7); }
  </style>
</head>
<body>
  <main>
    <h1>Unlock {{ .Host }}</h1>
    <p>This premium domain is protected by <strong>PayHole</strong>. To continue to <code>{{ .RequestURL }}</code>, complete the USDC unlock below.</p>
    <div class="card">
      <figure>
        <img src="{{ .QRDataURI }}" width="180" height="180" alt="PayHole QR">
        <figcaption>Scan with any Solana wallet to approve the unlock.</figcaption>
      </figure>
      <div class="actions">
        <a class="button primary" href="{{ .PayURL }}" target="_blank" rel="noreferrer">Open PayHole Checkout</a>
        <a class="button secondary" href="{{ .PhantomURL }}" target="_blank" rel="noreferrer">Pay with Phantom</a>
        <a class="button secondary" href="{{ .SolflareURL }}" target="_blank" rel="noreferrer">Pay with Solflare</a>
      </div>
    </div>
    <footer>Proof is valid for 30 days per wallet. Already paid? Ensure your browser is using the verified proxy token.</footer>
  </main>
</body>
</html>`
