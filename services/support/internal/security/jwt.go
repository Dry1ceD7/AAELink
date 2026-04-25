package security

import (
	"errors"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Claims mirrors the structure issued by the auth service. The optional
// fields (Roles, DepartmentID, IsITDept) are populated for tokens minted
// by recent auth versions and let downstream services (ticket, media,
// notify) enforce department-scoped data isolation without round-tripping
// to the auth API.
type Claims struct {
	UserID       uuid.UUID  `json:"sub"`
	Roles        []string   `json:"roles,omitempty"`
	DepartmentID *uuid.UUID `json:"dept,omitempty"`
	IsITDept     bool       `json:"it_dept,omitempty"`
	// IsSuper marks the platform super-admin identity. When true the
	// caller bypasses every data isolation rule.
	IsSuper bool `json:"is_super,omitempty"`
	jwt.RegisteredClaims
}

// HasRole returns true if the claim subject carries any of the supplied
// role names. Comparison is case-sensitive — role names are stored
// lower-case in the database.
func (c *Claims) HasRole(names ...string) bool {
	if c == nil {
		return false
	}
	for _, want := range names {
		for _, got := range c.Roles {
			if got == want {
				return true
			}
		}
	}
	return false
}

// IsSuperAdmin returns true when the claim subject is the platform
// super-admin (identity-level flag OR canonical `super_admin` role).
// Super-admins always bypass every data isolation rule.
func (c *Claims) IsSuperAdmin() bool {
	if c == nil {
		return false
	}
	if c.IsSuper {
		return true
	}
	return c.HasRole("super_admin")
}

// IsITStaff covers everyone allowed to view the global ticket queue:
// the platform super-admin, dedicated IT roles, or members of an
// IT-flagged department.
func (c *Claims) IsITStaff() bool {
	if c == nil {
		return false
	}
	if c.IsSuperAdmin() {
		return true
	}
	if c.IsITDept {
		return true
	}
	return c.HasRole("it_admin", "it_employee")
}

type Verifier struct {
	secret []byte
}

func NewVerifier(secret []byte) *Verifier {
	return &Verifier{secret: secret}
}

func (v *Verifier) Parse(tokenStr string) (*Claims, error) {
	parsed, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return v.secret, nil
	})
	if err != nil {
		return nil, err
	}
	c, ok := parsed.Claims.(*Claims)
	if !ok || !parsed.Valid {
		return nil, errors.New("invalid token")
	}
	return c, nil
}
