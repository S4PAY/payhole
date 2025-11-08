package policy

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/payhole/proxy/internal/analytics"
	"github.com/payhole/proxy/internal/auth"
	"github.com/payhole/proxy/internal/blocklist"
	"github.com/payhole/proxy/internal/classifier"
)

// DecisionReason describes why a request was blocked.
type DecisionReason string

const (
	ReasonAllowed        DecisionReason = "allowed"
	ReasonAdBlocked      DecisionReason = "ad_block"
	ReasonPremiumPayment DecisionReason = "premium_unlock_required"
	ReasonModelRisk      DecisionReason = "model_risk_block"
)

// Decision captures the outcome of a filtering check.
type Decision struct {
	Allow      bool
	StatusCode int
	Reason     DecisionReason
}

// Policy orchestrates blocklist, premium access, classifier, and analytics decisions.
type Policy struct {
	blocklist  blocklist.List
	premium    blocklist.List
	authorizer *auth.JWTAuthorizer
	ipCache    *auth.IPCache
	analytics  *analytics.Client
	classifier *classifier.Client
}

// New constructs a Policy.
func New(
	blocklist blocklist.List,
	premium blocklist.List,
	authorizer *auth.JWTAuthorizer,
	ipCache *auth.IPCache,
	analyticsClient *analytics.Client,
	classifierClient *classifier.Client,
) *Policy {
	return &Policy{
		blocklist:  blocklist,
		premium:    premium,
		authorizer: authorizer,
		ipCache:    ipCache,
		analytics:  analyticsClient,
		classifier: classifierClient,
	}
}

// Decide evaluates whether a host should be allowed for the given client context.
func (p *Policy) Decide(host, remoteAddr, authHeader string) Decision {
	if p == nil {
		return Decision{Allow: true, Reason: ReasonAllowed, StatusCode: 200}
	}

	canonicalHost := canonicalizeHost(host)
	if canonicalHost == "" {
		return Decision{Allow: true, Reason: ReasonAllowed, StatusCode: 200}
	}

	authorized := p.isAuthorized(remoteAddr, authHeader)

	if p.blocklist != nil && p.blocklist.Contains(canonicalHost) {
		p.record(canonicalHost, ReasonAdBlocked)
		return Decision{Allow: false, StatusCode: 403, Reason: ReasonAdBlocked}
	}

	if p.premium != nil && p.premium.Contains(canonicalHost) && !authorized {
		p.record(canonicalHost, ReasonPremiumPayment)
		return Decision{Allow: false, StatusCode: 402, Reason: ReasonPremiumPayment}
	}

	if p.classifier != nil && p.classifier.Enabled() {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		resp, err := p.classifier.Predict(ctx, classifier.Request{
			RequestID: fmt.Sprintf("%s-%d", canonicalHost, time.Now().UnixNano()),
			Domain:    canonicalHost,
			Numerical: map[string]float64{"domain_length": float64(len(canonicalHost))},
		})
		if err == nil && strings.EqualFold(resp.Label, "block") {
			p.record(canonicalHost, ReasonModelRisk)
			return Decision{Allow: false, StatusCode: 451, Reason: ReasonModelRisk}
		}
	}

	return Decision{Allow: true, StatusCode: 200, Reason: ReasonAllowed}
}

func (p *Policy) record(domain string, reason DecisionReason) {
	if p.analytics != nil {
		p.analytics.RecordBlocked(domain, string(reason))
	}
}

func (p *Policy) isAuthorized(remoteAddr, authHeader string) bool {
	if p.authorizer == nil {
		return false
	}

	if p.ipCache != nil && p.ipCache.IsAuthorized(remoteAddr) {
		return true
	}

	token := auth.ExtractBearer(authHeader)
	if token != "" {
		if claims, err := p.authorizer.Verify(token); err == nil {
			if p.ipCache != nil {
				expiry := auth.ExpiryFromClaims(claims)
				cacheExpiry := time.Now().Add(30 * time.Second)
				if cacheExpiry.Before(expiry) {
					expiry = cacheExpiry
				}
				p.ipCache.Authorize(remoteAddr, expiry)
			}
			return true
		}
	}

	return false
}

func canonicalizeHost(host string) string {
	if host == "" {
		return ""
	}
	h := strings.TrimSpace(host)
	if h == "" {
		return ""
	}
	if ip := net.ParseIP(h); ip != nil {
		return ip.String()
	}
	return strings.TrimSuffix(strings.ToLower(h), ".")
}
