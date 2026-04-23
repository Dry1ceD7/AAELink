package http

import (
	"github.com/gofiber/fiber/v3"

	"github.com/Dry1ceD7/AAELink/services/media/internal/security"
)

func RegisterRoutes(app *fiber.App, h *Handlers, v *security.Verifier) {
	api := app.Group("/api/media", AuthRequired(v))

	api.Post("/tickets/:id/files", h.Upload)
	api.Get("/tickets/:id/files", h.List)

	api.Get("/files/:fileId", h.Meta)
	api.Get("/files/:fileId/download", h.Download)
	api.Get("/files/:fileId/url", h.Presign)
}
