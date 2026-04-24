package http

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"github.com/Dry1ceD7/AAELink/services/ticket/internal/security"
)

const (
	ctxUserKey   = "auth.user_id"
	ctxClaimsKey = "auth.claims"
)

func AuthRequired(v *security.Verifier) fiber.Handler {
	return func(c fiber.Ctx) error {
		token := bearerToken(c)
		if token == "" {
			// Browsers cannot attach custom headers on the EventSource
			// API. The SSE endpoint accepts the token via ?token=...
			// only — every other route still requires the header.
			if isStreamPath(c) {
				token = strings.TrimSpace(c.Query("token"))
			}
		}
		if token == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized", Message: "missing token"})
		}
		claims, err := v.Parse(token)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized", Message: "invalid token"})
		}
		c.Locals(ctxUserKey, claims.UserID)
		c.Locals(ctxClaimsKey, claims)
		return c.Next()
	}
}

func bearerToken(c fiber.Ctx) string {
	header := c.Get("Authorization")
	if header == "" {
		return ""
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func isStreamPath(c fiber.Ctx) bool {
	return strings.HasSuffix(c.Path(), "/stream")
}

func userIDFromCtx(c fiber.Ctx) (uuid.UUID, error) {
	v := c.Locals(ctxUserKey)
	if v == nil {
		return uuid.Nil, errors.New("user id not in context")
	}
	id, ok := v.(uuid.UUID)
	if !ok {
		return uuid.Nil, errors.New("user id wrong type")
	}
	return id, nil
}

func claimsFromCtx(c fiber.Ctx) *security.Claims {
	v := c.Locals(ctxClaimsKey)
	if v == nil {
		return nil
	}
	if claims, ok := v.(*security.Claims); ok {
		return claims
	}
	return nil
}
