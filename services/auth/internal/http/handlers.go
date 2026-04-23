package http

import (
	"errors"

	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v3"
	"github.com/rs/zerolog/log"

	"github.com/Dry1ceD7/AAELink/services/auth/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/auth/internal/security"
	"github.com/Dry1ceD7/AAELink/services/auth/internal/service"
)

type Handlers struct {
	auth     *service.AuthService
	tokens   *security.TokenIssuer
	validate *validator.Validate
}

// sharedValidator is reused by admin handlers to keep validation consistent.
var sharedValidator = validator.New(validator.WithRequiredStructEnabled())

// getValidator exposes the package-level validator for sibling handlers.
func getValidator() *validator.Validate { return sharedValidator }

func NewHandlers(auth *service.AuthService, tokens *security.TokenIssuer) *Handlers {
	return &Handlers{
		auth:     auth,
		tokens:   tokens,
		validate: sharedValidator,
	}
}

func (h *Handlers) Register(app *fiber.App) {
	api := app.Group("/api/v1/auth")
	api.Post("/register", h.register)
	api.Post("/login", h.login)
	api.Post("/refresh", h.refresh)
	api.Post("/logout", h.logout)
	api.Get("/me", h.me, AuthRequired(h.tokens))
}

func (h *Handlers) register(c fiber.Ctx) error {
	var req registerRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := h.validate.Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}

	user, err := h.auth.Register(c.Context(), service.RegisterInput{
		Email:       req.Email,
		Password:    req.Password,
		DisplayName: req.DisplayName,
		Locale:      req.Locale,
	})
	if errors.Is(err, service.ErrEmailTaken) {
		return c.Status(fiber.StatusConflict).JSON(errorResponse{Error: "email_taken"})
	}
	if err != nil {
		log.Error().Err(err).Msg("register failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.Status(fiber.StatusCreated).JSON(userResponse{
		ID:              user.ID.String(),
		Email:           user.Email,
		DisplayName:     user.DisplayName,
		PreferredLocale: user.PreferredLocale,
		IsActive:        user.IsActive,
	})
}

func (h *Handlers) login(c fiber.Ctx) error {
	var req loginRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := h.validate.Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}

	res, err := h.auth.Login(c.Context(), service.LoginInput{
		Email:     req.Email,
		Password:  req.Password,
		IP:        c.IP(),
		UserAgent: c.Get("User-Agent"),
	})
	if errors.Is(err, service.ErrInvalidCredentials) {
		return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "invalid_credentials"})
	}
	if errors.Is(err, service.ErrInactiveUser) {
		return c.Status(fiber.StatusForbidden).JSON(errorResponse{Error: "inactive_user"})
	}
	if err != nil {
		log.Error().Err(err).Msg("login failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.JSON(toAuthResponse(res))
}

func (h *Handlers) refresh(c fiber.Ctx) error {
	var req refreshRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := h.validate.Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}

	res, err := h.auth.Refresh(c.Context(), req.RefreshToken, c.IP(), c.Get("User-Agent"))
	if errors.Is(err, service.ErrInvalidRefresh) {
		return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "invalid_refresh_token"})
	}
	if errors.Is(err, service.ErrInactiveUser) {
		return c.Status(fiber.StatusForbidden).JSON(errorResponse{Error: "inactive_user"})
	}
	if err != nil {
		log.Error().Err(err).Msg("refresh failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.JSON(toAuthResponse(res))
}

func (h *Handlers) logout(c fiber.Ctx) error {
	var req logoutRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := h.validate.Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	if err := h.auth.Logout(c.Context(), req.RefreshToken); err != nil {
		log.Error().Err(err).Msg("logout failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handlers) me(c fiber.Ctx) error {
	userID, err := userIDFromCtx(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized"})
	}
	user, roles, err := h.auth.Me(c.Context(), userID)
	if errors.Is(err, repository.ErrNotFound) {
		return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "user_not_found"})
	}
	if err != nil {
		log.Error().Err(err).Msg("me failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.JSON(userResponse{
		ID:              user.ID.String(),
		Email:           user.Email,
		DisplayName:     user.DisplayName,
		PreferredLocale: user.PreferredLocale,
		IsActive:        user.IsActive,
		Roles:           roles,
	})
}

func badRequest(c fiber.Ctx, code, msg string) error {
	return c.Status(fiber.StatusBadRequest).JSON(errorResponse{Error: code, Message: msg})
}

func toAuthResponse(r *service.AuthResult) authResponse {
	return authResponse{
		User: userResponse{
			ID:              r.User.ID.String(),
			Email:           r.User.Email,
			DisplayName:     r.User.DisplayName,
			PreferredLocale: r.User.PreferredLocale,
			IsActive:        r.User.IsActive,
			Roles:           r.Roles,
		},
		Tokens: tokenResponse{
			AccessToken:      r.Tokens.AccessToken,
			RefreshToken:     r.Tokens.RefreshToken,
			TokenType:        "Bearer",
			AccessExpiresAt:  r.Tokens.AccessExp,
			RefreshExpiresAt: r.Tokens.RefreshExp,
		},
	}
}
