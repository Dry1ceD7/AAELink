package security

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Claims struct {
	UserID       uuid.UUID  `json:"sub"`
	Email        string     `json:"email"`
	Roles        []string   `json:"roles,omitempty"`
	DepartmentID *uuid.UUID `json:"dept,omitempty"`
	IsITDept     bool       `json:"it_dept,omitempty"`
	// IsSuper is the identity-level super-admin flag. When true the
	// caller bypasses every data isolation rule across the platform.
	IsSuper bool `json:"is_super,omitempty"`
	jwt.RegisteredClaims
}

// AccessClaims captures the optional context the auth service can embed
// into a freshly issued access token. Downstream services (ticket, media,
// notify) read these to enforce department-scoped isolation without
// having to call back into auth on every request.
type AccessClaims struct {
	Roles        []string
	DepartmentID *uuid.UUID
	IsITDept     bool
	IsSuper      bool
}

type TokenIssuer struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewTokenIssuer(secret []byte, accessTTL, refreshTTL time.Duration) *TokenIssuer {
	return &TokenIssuer{secret: secret, accessTTL: accessTTL, refreshTTL: refreshTTL}
}

func (t *TokenIssuer) AccessTTL() time.Duration  { return t.accessTTL }
func (t *TokenIssuer) RefreshTTL() time.Duration { return t.refreshTTL }

// IssueAccess returns a signed JWT access token enriched with the caller's
// roles and department so downstream services can enforce isolation
// without re-querying auth on every request.
func (t *TokenIssuer) IssueAccess(userID uuid.UUID, email string, ctx AccessClaims) (string, time.Time, error) {
	now := time.Now().UTC()
	exp := now.Add(t.accessTTL)
	claims := Claims{
		UserID:       userID,
		Email:        email,
		Roles:        ctx.Roles,
		DepartmentID: ctx.DepartmentID,
		IsITDept:     ctx.IsITDept,
		IsSuper:      ctx.IsSuper,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "aaelink-auth",
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
			ID:        uuid.NewString(),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(t.secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, exp, nil
}

// ParseAccess validates and returns the access claims.
func (t *TokenIssuer) ParseAccess(tokenStr string) (*Claims, error) {
	claims := &Claims{}
	tok, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return t.secret, nil
	})
	if err != nil {
		return nil, err
	}
	if !tok.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// NewRefreshToken returns an opaque random refresh token (base64) and its sha256 hash.
func NewRefreshToken() (token string, hash string, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	token = hex.EncodeToString(buf)
	sum := sha256.Sum256([]byte(token))
	hash = hex.EncodeToString(sum[:])
	return token, hash, nil
}

// HashRefreshToken hashes a refresh token for lookup.
func HashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
