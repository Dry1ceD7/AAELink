package http

import (
	"github.com/gofiber/fiber/v3"

	"github.com/Dry1ceD7/AAELink/services/media/internal/security"
)

func RegisterRoutes(app *fiber.App, h *Handlers, v *security.Verifier) {
	// Public endpoints — used by <img> tags so they cannot require Authorization
	// headers. The avatar route is read-only and only exposes the user's own
	// profile picture by user ID, not arbitrary storage keys.
	pub := app.Group("/api/media/public")
	pub.Get("/avatar/:userId", h.PublicAvatar)

	api := app.Group("/api/media", AuthRequired(v))

	api.Post("/tickets/:id/files", h.Upload)
	api.Get("/tickets/:id/files", h.List)

	api.Get("/files/:fileId", h.Meta)
	api.Get("/files/:fileId/download", h.Download)
	api.Get("/files/:fileId/url", h.Presign)

	api.Post("/profile/avatar", h.UploadAvatar)
}
