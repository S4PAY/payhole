package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestJWTAuthorizerVerify(t *testing.T) {
	authorizer, err := NewJWTAuthorizer("abcdefghijklmnopqrstuvwxyz123456")
	if err != nil {
		t.Fatalf("init failed: %v", err)
	}

	claims := &UnlockClaims{
		Wallet: "wallet123",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}

	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("abcdefghijklmnopqrstuvwxyz123456"))
	if err != nil {
		t.Fatalf("sign failed: %v", err)
	}

	parsed, err := authorizer.Verify(token)
	if err != nil {
		t.Fatalf("verify failed: %v", err)
	}

	if parsed.Wallet != "wallet123" {
		t.Fatalf("unexpected wallet: %s", parsed.Wallet)
	}
}

func TestExtractBearer(t *testing.T) {
	if token := ExtractBearer("Bearer abc"); token != "abc" {
		t.Fatalf("expected token abc got %s", token)
	}

	if token := ExtractBearer("Basic abc"); token != "" {
		t.Fatalf("expected empty token for non bearer")
	}
}

