package http

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"github.com/Dry1ceD7/AAELink/services/media/internal/security"
)

const ctxUserKey = "user_id"

func AuthRequired(v *security.Verifier) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Anything served from /api/media/public/* is intentionally anonymous
		// (e.g. profile avatars consumed directly by <img> tags).
		if strings.HasPrefix(c.Path(), "/api/media/public/") {
			return c.Next()
		}
		header := c.Get("Authorization")
		if header == "" {
			return fiber.NewError(fiber.StatusUnauthorized, "missing authorization header")
		}
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			return fiber.NewError(fiber.StatusUnauthorized, "invalid authorization header")
		}
		claims, err := v.Parse(parts[1])
		if err != nil {
			return fiber.NewError(fiber.StatusUnauthorized, "invalid token")
		}
		c.Locals(ctxUserKey, claims.UserID)
		return c.Next()
	}
}

func userIDFromCtx(c fiber.Ctx) (uuid.UUID, error) {
	v := c.Locals(ctxUserKey)
	if v == nil {
		return uuid.Nil, errors.New("unauthenticated")
	}
	id, ok := v.(uuid.UUID)
	if !ok {
		return uuid.Nil, errors.New("invalid user context")
	}
	return id, nil
}
