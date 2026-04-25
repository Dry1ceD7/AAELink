package http

import (
	"fmt"
	"io"
	"mime"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"

	"github.com/Dry1ceD7/AAELink/services/media/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/media/internal/storage"
)

type Handlers struct {
	repo           *repository.FileRepo
	store          *storage.Client
	maxUploadBytes int64
	maxAvatarBytes int64
}

func NewHandlers(repo *repository.FileRepo, store *storage.Client, maxUploadBytes, maxAvatarBytes int64) *Handlers {
	return &Handlers{repo: repo, store: store, maxUploadBytes: maxUploadBytes, maxAvatarBytes: maxAvatarBytes}
}

type fileDTO struct {
	ID         string `json:"id"`
	TicketID   string `json:"ticket_id"`
	Filename   string `json:"filename"`
	MimeType   string `json:"mime_type"`
	FileSize   int64  `json:"file_size"`
	Kind       string `json:"kind"`
	UploadedBy string `json:"uploaded_by"`
	UploadedAt string `json:"uploaded_at"`
	URL        string `json:"url,omitempty"`
}

func toDTO(f repository.File) fileDTO {
	return fileDTO{
		ID:         f.ID.String(),
		TicketID:   f.TicketID.String(),
		Filename:   f.Filename,
		MimeType:   f.MimeType,
		FileSize:   f.FileSize,
		Kind:       classifyKind(f.Filename, f.MimeType),
		UploadedBy: f.UploadedBy.String(),
		UploadedAt: f.UploadedAt.UTC().Format(time.RFC3339),
	}
}

func (h *Handlers) Upload(c fiber.Ctx) error {
	uid, err := userIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, err.Error())
	}
	ticketID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid ticket id")
	}

	ctx := c.Context()
	exists, err := h.repo.TicketExists(ctx, ticketID)
	if err != nil {
		return err
	}
	if !exists {
		return fiber.NewError(fiber.StatusNotFound, "ticket not found")
	}

	fh, err := c.FormFile("file")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "missing file field")
	}
	if fh.Size <= 0 {
		return fiber.NewError(fiber.StatusBadRequest, "empty file")
	}
	if h.maxUploadBytes > 0 && fh.Size > h.maxUploadBytes {
		return fiber.NewError(fiber.StatusRequestEntityTooLarge,
			fmt.Sprintf("file exceeds max size of %d bytes", h.maxUploadBytes))
	}

	f, err := fh.Open()
	if err != nil {
		return fmt.Errorf("open upload: %w", err)
	}
	defer f.Close()

	cleanName := sanitizeFilename(fh.Filename)
	contentType := fh.Header.Get("Content-Type")
	if contentType == "" {
		contentType = guessContentType(cleanName)
	}

	now := time.Now().UTC()
	fileID := uuid.New()
	key := fmt.Sprintf("tickets/%s/%s/%s/%s%s",
		ticketID.String(),
		now.Format("2006"),
		now.Format("01"),
		fileID.String(),
		strings.ToLower(filepath.Ext(cleanName)),
	)

	if err := h.store.PutObject(ctx, key, f, fh.Size, contentType); err != nil {
		return fmt.Errorf("store: %w", err)
	}

	rec := &repository.File{
		ID:         fileID,
		TicketID:   ticketID,
		Filename:   cleanName,
		StorageKey: key,
		MimeType:   contentType,
		FileSize:   fh.Size,
		UploadedBy: uid,
		UploadedAt: now,
	}
	if err := h.repo.Insert(ctx, rec); err != nil {
		_ = h.store.RemoveObject(ctx, key)
		return fmt.Errorf("db insert: %w", err)
	}

	return c.Status(fiber.StatusCreated).JSON(toDTO(*rec))
}

func (h *Handlers) List(c fiber.Ctx) error {
	if _, err := userIDFromCtx(c); err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, err.Error())
	}
	ticketID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid ticket id")
	}
	files, err := h.repo.ListByTicket(c.Context(), ticketID)
	if err != nil {
		return err
	}
	out := make([]fileDTO, 0, len(files))
	for _, f := range files {
		out = append(out, toDTO(f))
	}
	return c.JSON(fiber.Map{"files": out, "count": len(out)})
}

func (h *Handlers) Meta(c fiber.Ctx) error {
	if _, err := userIDFromCtx(c); err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, err.Error())
	}
	id, err := uuid.Parse(c.Params("fileId"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid file id")
	}
	rec, err := h.repo.Get(c.Context(), id)
	if err != nil {
		return err
	}
	if rec == nil {
		return fiber.NewError(fiber.StatusNotFound, "file not found")
	}
	dto := toDTO(*rec)
	ttl := 15 * time.Minute
	url, err := h.store.PresignGet(c.Context(), rec.StorageKey, rec.Filename, ttl)
	if err == nil {
		dto.URL = url
	}
	return c.JSON(dto)
}

func (h *Handlers) Download(c fiber.Ctx) error {
	if _, err := userIDFromCtx(c); err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, err.Error())
	}
	id, err := uuid.Parse(c.Params("fileId"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid file id")
	}
	rec, err := h.repo.Get(c.Context(), id)
	if err != nil {
		return err
	}
	if rec == nil {
		return fiber.NewError(fiber.StatusNotFound, "file not found")
	}
	obj, size, ctype, err := h.store.GetObject(c.Context(), rec.StorageKey)
	if err != nil {
		return fmt.Errorf("fetch: %w", err)
	}
	defer obj.Close()

	if ctype == "" {
		ctype = rec.MimeType
	}
	c.Set("Content-Type", ctype)
	c.Set("Content-Length", fmt.Sprintf("%d", size))
	c.Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, rec.Filename))
	_, err = io.Copy(c.Response().BodyWriter(), obj)
	return err
}

func (h *Handlers) Presign(c fiber.Ctx) error {
	if _, err := userIDFromCtx(c); err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, err.Error())
	}
	id, err := uuid.Parse(c.Params("fileId"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid file id")
	}
	rec, err := h.repo.Get(c.Context(), id)
	if err != nil {
		return err
	}
	if rec == nil {
		return fiber.NewError(fiber.StatusNotFound, "file not found")
	}
	ttl := 15 * time.Minute
	url, err := h.store.PresignGet(c.Context(), rec.StorageKey, rec.Filename, ttl)
	if err != nil {
		return fmt.Errorf("presign: %w", err)
	}
	return c.JSON(fiber.Map{
		"url":        url,
		"expires_in": int(ttl.Seconds()),
		"filename":   rec.Filename,
		"mime_type":  rec.MimeType,
	})
}

func sanitizeFilename(name string) string {
	base := filepath.Base(name)
	base = strings.ReplaceAll(base, "\x00", "")
	if base == "." || base == ".." || base == "" {
		return "file"
	}
	if len(base) > 255 {
		base = base[:255]
	}
	return base
}

func guessContentType(name string) string {
	if ct := mime.TypeByExtension(strings.ToLower(filepath.Ext(name))); ct != "" {
		return ct
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".dwg":
		return "application/acad"
	case ".dxf":
		return "application/dxf"
	case ".step", ".stp":
		return "application/step"
	case ".iges", ".igs":
		return "application/iges"
	case ".stl":
		return "model/stl"
	}
	return "application/octet-stream"
}

// ── Profile avatar ──────────────────────────────────────────────────────────

var allowedAvatarTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

func avatarKey(uid uuid.UUID) string {
	return fmt.Sprintf("avatars/%s/avatar", uid.String())
}

// UploadAvatar accepts a multipart `file` field and stores it as the caller's
// profile picture. The storage key is deterministic, so old avatars are
// overwritten on each upload.
func (h *Handlers) UploadAvatar(c fiber.Ctx) error {
	uid, err := userIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, err.Error())
	}
	fh, err := c.FormFile("file")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "missing file field")
	}
	if fh.Size <= 0 {
		return fiber.NewError(fiber.StatusBadRequest, "empty file")
	}
	if h.maxAvatarBytes > 0 && fh.Size > h.maxAvatarBytes {
		return fiber.NewError(fiber.StatusRequestEntityTooLarge,
			fmt.Sprintf("avatar exceeds max size of %d bytes", h.maxAvatarBytes))
	}

	contentType := fh.Header.Get("Content-Type")
	if contentType == "" {
		contentType = guessContentType(fh.Filename)
	}
	if _, ok := allowedAvatarTypes[contentType]; !ok {
		return fiber.NewError(fiber.StatusUnsupportedMediaType,
			"avatar must be PNG, JPEG, WebP or GIF")
	}

	f, err := fh.Open()
	if err != nil {
		return fmt.Errorf("open upload: %w", err)
	}
	defer f.Close()

	key := avatarKey(uid)
	if err := h.store.PutObject(c.Context(), key, f, fh.Size, contentType); err != nil {
		return fmt.Errorf("store: %w", err)
	}

	publicURL := fmt.Sprintf("/api/media/public/avatar/%s?v=%d",
		uid.String(), time.Now().Unix())
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"url":          publicURL,
		"content_type": contentType,
		"size":         fh.Size,
	})
}

// PublicAvatar streams the current avatar for a user by ID. Returns 404 when
// the user has not uploaded one yet.
func (h *Handlers) PublicAvatar(c fiber.Ctx) error {
	uid, err := uuid.Parse(c.Params("userId"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid user id")
	}
	key := avatarKey(uid)
	obj, size, ctype, err := h.store.GetObject(c.Context(), key)
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "avatar not found")
	}
	defer obj.Close()
	if ctype == "" {
		ctype = "image/png"
	}
	c.Set("Content-Type", ctype)
	c.Set("Content-Length", fmt.Sprintf("%d", size))
	c.Set("Cache-Control", "private, max-age=60")
	_, err = io.Copy(c.Response().BodyWriter(), obj)
	return err
}

func classifyKind(name, mimeType string) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".dwg", ".dxf", ".step", ".stp", ".iges", ".igs", ".stl", ".ipt", ".iam", ".sldprt", ".sldasm", ".catpart", ".catproduct", ".prt":
		return "cad"
	}
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "image"
	case strings.HasPrefix(mimeType, "video/"):
		return "video"
	case strings.HasPrefix(mimeType, "audio/"):
		return "audio"
	case mimeType == "application/pdf":
		return "pdf"
	case strings.Contains(mimeType, "word") || ext == ".doc" || ext == ".docx":
		return "doc"
	case strings.Contains(mimeType, "sheet") || ext == ".xls" || ext == ".xlsx" || ext == ".csv":
		return "sheet"
	case strings.Contains(mimeType, "presentation") || ext == ".ppt" || ext == ".pptx":
		return "slides"
	case strings.Contains(mimeType, "zip") || strings.Contains(mimeType, "compressed") || ext == ".zip" || ext == ".rar" || ext == ".7z" || ext == ".tar" || ext == ".gz":
		return "archive"
	}
	return "file"
}
