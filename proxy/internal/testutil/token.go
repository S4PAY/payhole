package testutil

import (
    "testing"
    "time"

    "github.com/golang-jwt/jwt/v5"
)

// MakeToken generates a signed JWT compatible with the payments service for testing.
func MakeToken(t *testing.T, secret, wallet string, ttl time.Duration) string {
    t.Helper()

    claims := jwt.RegisteredClaims{
        Issuer:    "payhole-payments",
        Subject:   wallet,
        ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
        IssuedAt:  jwt.NewNumericDate(time.Now()),
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
        "wallet":           wallet,
        "iss":              claims.Issuer,
        "sub":              claims.Subject,
        "exp":              claims.ExpiresAt.Time.Unix(),
        "iat":              claims.IssuedAt.Time.Unix(),
    })

    signed, err := token.SignedString([]byte(secret))
    if err != nil {
        t.Fatalf("failed to sign token: %v", err)
    }
    return signed
}

