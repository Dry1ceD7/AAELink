package http

import (
	"strings"

	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"github.com/Dry1ceD7/AAELink/services/documents/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/documents/internal/security"
)

const (
	ctxUserKey   = "auth.user_id"
	ctxClaimsKey = "auth.claims"
)

type Handlers struct {
	repo     *repository.Repository
	verifier *security.Verifier
	validate *validator.Validate
}

func New(repo *repository.Repository, verifier *security.Verifier) *Handlers {
	return &Handlers{repo: repo, verifier: verifier, validate: validator.New(validator.WithRequiredStructEnabled())}
}

type registerDocumentRequest struct {
	Filename   string `json:"filename" validate:"required,min=1,max=255"`
	MimeType   string `json:"mime_type" validate:"required,eq=application/pdf"`
	FileSize   int64  `json:"file_size" validate:"required,min=1"`
	StorageKey string `json:"storage_key" validate:"required,min=4,max=1000"`
}

type operationRequest struct {
	Operation  string         `json:"operation" validate:"required,oneof=preview ocr redact annotate form_fill merge split rotate sign export"`
	Parameters map[string]any `json:"parameters"`
}

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

func (h *Handlers) Register(app *fiber.App) {
	api := app.Group("/api/v1/documents", h.authRequired)
	api.Get("/", h.list)
	api.Post("/", h.registerDocument)
	api.Post("/:id/operations", h.queueOperation)
}

func (h *Handlers) list(c fiber.Ctx) error {
	uid, claims, err := contextFrom(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized"})
	}
	rows, err := h.repo.List(c.Context(), uid, claims.IsITStaff())
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"documents": rows, "count": len(rows)})
}

func (h *Handlers) registerDocument(c fiber.Ctx) error {
	uid, _, err := contextFrom(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized"})
	}
	var req registerDocumentRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := h.validate.Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	out, err := h.repo.RegisterDocument(c.Context(), uid, strings.TrimSpace(req.Filename), req.MimeType, req.FileSize, strings.TrimSpace(req.StorageKey))
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(out)
}

func (h *Handlers) queueOperation(c fiber.Ctx) error {
	uid, _, err := contextFrom(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized"})
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_document_id", err.Error())
	}
	var req operationRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := h.validate.Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	out, err := h.repo.QueueOperation(c.Context(), id, uid, req.Operation, req.Parameters)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusAccepted).JSON(out)
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
	c.Locals(ctxUserKey, claims.UserID)
	c.Locals(ctxClaimsKey, claims)
	return c.Next()
}

func contextFrom(c fiber.Ctx) (uuid.UUID, *security.Claims, error) {
	uid, ok := c.Locals(ctxUserKey).(uuid.UUID)
	if !ok {
		return uuid.Nil, nil, fiber.ErrUnauthorized
	}
	claims, ok := c.Locals(ctxClaimsKey).(*security.Claims)
	if !ok || claims == nil {
		return uuid.Nil, nil, fiber.ErrUnauthorized
	}
	return uid, claims, nil
}

func badRequest(c fiber.Ctx, code, msg string) error {
	return c.Status(fiber.StatusBadRequest).JSON(errorResponse{Error: code, Message: msg})
}
