package http

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"github.com/Dry1ceD7/AAELink/services/auth/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/auth/internal/security"
)

const (
	ctxUserKey  = "auth.user_id"
	ctxRolesKey = "auth.roles"
)

// AuthRequired validates a Bearer JWT and sets user id into ctx locals.
func AuthRequired(tokens *security.TokenIssuer) fiber.Handler {
	return func(c fiber.Ctx) error {
		header := c.Get("Authorization")
		if header == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized", Message: "missing Authorization header"})
		}
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized", Message: "invalid Authorization header"})
		}
		claims, err := tokens.ParseAccess(parts[1])
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized", Message: "invalid token"})
		}
		c.Locals(ctxUserKey, claims.UserID)
		return c.Next()
	}
}

// RequireRole returns a middleware that allows the request only if the
// authenticated user has at least one of the given role names.
// MUST be chained AFTER AuthRequired.
func RequireRole(users *repository.UserRepository, allowed ...string) fiber.Handler {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, r := range allowed {
		allowedSet[r] = struct{}{}
	}
	return func(c fiber.Ctx) error {
		uid, err := userIDFromCtx(c)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized"})
		}
		roles, err := users.FindRoles(c.Context(), uid)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
		}
		for _, r := range roles {
			if _, ok := allowedSet[r]; ok {
				c.Locals(ctxRolesKey, roles)
				return c.Next()
			}
		}
		return c.Status(fiber.StatusForbidden).JSON(errorResponse{Error: "forbidden", Message: "insufficient role"})
	}
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
