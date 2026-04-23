package http

import (
	"bufio"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/Dry1ceD7/AAELink/services/ticket/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/security"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/service"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/sse"
)

type Handlers struct {
	tickets  *service.TicketService
	verifier *security.Verifier
	hub      *sse.Hub
	validate *validator.Validate
}

func NewHandlers(t *service.TicketService, v *security.Verifier, h *sse.Hub) *Handlers {
	return &Handlers{
		tickets:  t,
		verifier: v,
		hub:      h,
		validate: validator.New(validator.WithRequiredStructEnabled()),
	}
}

func (h *Handlers) Register(app *fiber.App) {
	api := app.Group("/api/v1/tickets", AuthRequired(h.verifier))
	api.Post("/", h.create)
	api.Get("/", h.list)
	api.Get("/stream", h.stream)
	api.Get("/:id", h.get)
	api.Patch("/:id/status", h.updateStatus)
	api.Patch("/:id/assign", h.assign)
	api.Get("/:id/comments", h.listComments)
	api.Post("/:id/comments", h.addComment)
}

func (h *Handlers) create(c fiber.Ctx) error {
	uid, err := userIDFromCtx(c)
	if err != nil {
		return unauthorized(c)
	}
	var req createTicketRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := h.validate.Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	priority := req.Priority
	if priority == "" {
		priority = "medium"
	}
	t, err := h.tickets.Create(c.Context(), repository.CreateTicketParams{
		Title:        req.Title,
		Description:  req.Description,
		Priority:     priority,
		CategoryID:   req.CategoryID,
		CreatedBy:    uid,
		DepartmentID: req.DepartmentID,
	})
	if err != nil {
		log.Error().Err(err).Msg("create ticket failed")
		return internalError(c)
	}
	return c.Status(fiber.StatusCreated).JSON(t)
}

func (h *Handlers) list(c fiber.Ctx) error {
	f := repository.ListFilter{
		Status: c.Query("status"),
	}
	if v := c.Query("assigned_to"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			f.AssignedTo = &id
		}
	}
	if v := c.Query("created_by"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			f.CreatedBy = &id
		}
	}
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.Limit = n
		}
	}
	if v := c.Query("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.Offset = n
		}
	}
	out, err := h.tickets.List(c.Context(), f)
	if err != nil {
		log.Error().Err(err).Msg("list tickets failed")
		return internalError(c)
	}
	return c.JSON(out)
}

func (h *Handlers) get(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", "id must be uuid")
	}
	t, err := h.tickets.Get(c.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "not_found"})
	}
	if err != nil {
		return internalError(c)
	}
	return c.JSON(t)
}

func (h *Handlers) updateStatus(c fiber.Ctx) error {
	uid, err := userIDFromCtx(c)
	if err != nil {
		return unauthorized(c)
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", "id must be uuid")
	}
	var req updateStatusRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := h.validate.Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	t, err := h.tickets.UpdateStatus(c.Context(), id, req.Status, uid)
	if errors.Is(err, repository.ErrNotFound) {
		return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "not_found"})
	}
	if err != nil {
		return internalError(c)
	}
	return c.JSON(t)
}

func (h *Handlers) assign(c fiber.Ctx) error {
	uid, err := userIDFromCtx(c)
	if err != nil {
		return unauthorized(c)
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", "id must be uuid")
	}
	var req assignRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := h.validate.Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	t, err := h.tickets.Assign(c.Context(), id, req.AssigneeID, uid)
	if errors.Is(err, repository.ErrNotFound) {
		return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "not_found"})
	}
	if err != nil {
		return internalError(c)
	}
	return c.JSON(t)
}

func (h *Handlers) listComments(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", "id must be uuid")
	}
	out, err := h.tickets.ListComments(c.Context(), id)
	if err != nil {
		return internalError(c)
	}
	return c.JSON(out)
}

func (h *Handlers) addComment(c fiber.Ctx) error {
	uid, err := userIDFromCtx(c)
	if err != nil {
		return unauthorized(c)
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", "id must be uuid")
	}
	var req createCommentRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := h.validate.Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	cm, err := h.tickets.AddComment(c.Context(), id, uid, req.Content, req.IsInternal)
	if err != nil {
		return internalError(c)
	}
	return c.Status(fiber.StatusCreated).JSON(cm)
}

// stream pushes ticket events to the client over Server-Sent Events.
func (h *Handlers) stream(c fiber.Ctx) error {
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("X-Accel-Buffering", "no")

	ch := h.hub.Subscribe()

	c.Response().SetBodyStreamWriter(func(w *bufio.Writer) {
		defer h.hub.Unsubscribe(ch)
		ping := time.NewTicker(15 * time.Second)
		defer ping.Stop()
		// initial comment to open the stream
		if _, err := fmt.Fprintf(w, ": connected\n\n"); err != nil {
			return
		}
		if err := w.Flush(); err != nil {
			return
		}
		for {
			select {
			case msg, ok := <-ch:
				if !ok {
					return
				}
				if _, err := fmt.Fprintf(w, "event: ticket\ndata: %s\n\n", msg); err != nil {
					return
				}
				if err := w.Flush(); err != nil {
					return
				}
			case <-ping.C:
				if _, err := fmt.Fprintf(w, ": ping\n\n"); err != nil {
					return
				}
				if err := w.Flush(); err != nil {
					return
				}
			}
		}
	})
	return nil
}

func badRequest(c fiber.Ctx, code, msg string) error {
	return c.Status(fiber.StatusBadRequest).JSON(errorResponse{Error: code, Message: msg})
}

func unauthorized(c fiber.Ctx) error {
	return c.Status(fiber.StatusUnauthorized).JSON(errorResponse{Error: "unauthorized"})
}

func internalError(c fiber.Ctx) error {
	return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
}
