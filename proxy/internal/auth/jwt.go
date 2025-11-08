package auth

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type UnlockClaims struct {
	Wallet string `json:"wallet"`
	jwt.RegisteredClaims
}

type JWTAuthorizer struct {
	secret       []byte
	entitlements *EntitlementCache
}

func NewJWTAuthorizer(secret string, cache *EntitlementCache) (*JWTAuthorizer, error) {
	if len(secret) < 32 {
		return nil, errors.New("JWT secret must be at least 32 characters")
	}
	if cache == nil {
		cache = NewEntitlementCache()
	}
	return &JWTAuthorizer{secret: []byte(secret), entitlements: cache}, nil
}

func (a *JWTAuthorizer) Verify(token string) (*UnlockClaims, error) {
	if token == "" {
		return nil, errors.New("token is empty")
	}

	parsed, err := jwt.ParseWithClaims(token, &UnlockClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %s", t.Header["alg"])
		}
		return a.secret, nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := parsed.Claims.(*UnlockClaims)
	if !ok || !parsed.Valid {
		return nil, errors.New("invalid token claims")
	}

	if claims.ExpiresAt == nil {
		return nil, errors.New("token missing expiry")
	}

	if claims.Wallet == "" {
		return nil, errors.New("token missing wallet claim")
	}

	if a.entitlements != nil && claims.ExpiresAt != nil {
		a.entitlements.Grant(claims.Wallet, claims.ExpiresAt.Time)
	}

	return claims, nil
}

// Entitlements exposes the underlying wallet cache for policy enforcement.
func (a *JWTAuthorizer) Entitlements() *EntitlementCache {
	return a.entitlements
}

func ExtractBearer(header string) string {
	if header == "" {
		return ""
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 {
		return ""
	}
	if !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func ExpiryFromClaims(claims *UnlockClaims) time.Time {
	if claims == nil || claims.ExpiresAt == nil {
		return time.Now()
	}
	return claims.ExpiresAt.Time
}
