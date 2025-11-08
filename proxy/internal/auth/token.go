package auth

import (
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims represents the structure embedded in payments-issued JWT tokens.
type Claims struct {
	Wallet string `json:"wallet"`
	jwt.RegisteredClaims
}

type Validator struct {
	secret []byte
}

func NewValidator(secret string) *Validator {
	return &Validator{secret: []byte(secret)}
}

// Validate parses and verifies a JWT, returning the associated wallet when valid.
func (v *Validator) Validate(token string) (*Claims, error) {
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("token missing")
	}

	claims := &Claims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
		if t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, errors.New("unexpected signing method")
		}
		return v.secret, nil
	}, jwt.WithIssuer("payhole-payments"))
	if err != nil {
		return nil, err
	}
	if !parsed.Valid {
		return nil, errors.New("invalid token")
	}

	if claims.Wallet == "" {
		return nil, errors.New("wallet missing from claims")
	}

	if claims.ExpiresAt == nil || claims.ExpiresAt.Before(time.Now()) {
		return nil, errors.New("token expired")
	}

	return claims, nil
}

// IsAuthorized returns true when the token is present and valid.
func (v *Validator) IsAuthorized(token string) bool {
	_, err := v.Validate(token)
	return err == nil
}

// ExtractBearerToken pulls the JWT from a standard Authorization header.
func ExtractBearerToken(header string) string {
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

