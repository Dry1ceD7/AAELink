package http

import (
	"strings"

	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v3"

	"github.com/Dry1ceD7/AAELink/services/support/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/support/internal/security"
)

const ctxClaimsKey = "auth.claims"

type Handlers struct {
	repo     *repository.Repository
	verifier *security.Verifier
	validate *validator.Validate
}

func New(repo *repository.Repository, verifier *security.Verifier) *Handlers {
	return &Handlers{repo: repo, verifier: verifier, validate: validator.New(validator.WithRequiredStructEnabled())}
}

type createRequest struct {
	Requester string `json:"requester" validate:"required,min=2,max=255"`
	Subject   string `json:"subject" validate:"required,min=2,max=180"`
	Message   string `json:"message" validate:"required,min=4,max=4000"`
}

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

func (h *Handlers) Register(app *fiber.App) {
	api := app.Group("/api/v1/support")
	api.Post("/emergency", h.createEmergency)
	protected := api.Group("", h.authRequired, h.requireIT)
	protected.Get("/requests", h.listRequests)
}

func (h *Handlers) createEmergency(c fiber.Ctx) error {
	var req createRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := h.validate.Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	out, err := h.repo.Create(c.Context(), repository.CreateParams{
		Requester: strings.TrimSpace(req.Requester),
		Subject:   strings.TrimSpace(req.Subject),
		Message:   strings.TrimSpace(req.Message),
	})
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(out)
}

func (h *Handlers) listRequests(c fiber.Ctx) error {
	rows, err := h.repo.List(c.Context(), 200)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"requests": rows, "count": len(rows)})
}

func (h *Handlers) authRequired(c fiber.Ctx) error {
	header := c.Get("Authorization")
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized", Message: "missing bearer token"})
	}
	claims, err := h.verifier.Parse(parts[1])
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized", Message: "invalid token"})
	}
	c.Locals(ctxClaimsKey, claims)
	return c.Next()
}

func (h *Handlers) requireIT(c fiber.Ctx) error {
	claims := claimsFromContext(c)
	if claims == nil || !claims.IsITStaff() {
		return c.Status(fiber.StatusForbidden).JSON(errorResponse{Error: "forbidden"})
	}
	return c.Next()
}

func claimsFromContext(c fiber.Ctx) *security.Claims {
	switch v := c.Locals(ctxClaimsKey).(type) {
	case *security.Claims:
		return v
	case security.Claims:
		return &v
	default:
		return nil
	}
}

func badRequest(c fiber.Ctx, code, msg string) error {
	return c.Status(fiber.StatusBadRequest).JSON(errorResponse{Error: code, Message: msg})
}
