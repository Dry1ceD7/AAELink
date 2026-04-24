package http

import (
	"errors"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/Dry1ceD7/AAELink/services/auth/internal/repository"
)

// ── Roles ───────────────────────────────────────────────────────────────────

func (h *AdminHandlers) listRoles(c fiber.Ctx) error {
	rows, err := h.roles.ListAll(c.Context())
	if err != nil {
		log.Error().Err(err).Msg("admin list roles failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	resp := rolesListResponse{
		Roles: make([]roleResponse, 0, len(rows)),
		Count: len(rows),
	}
	for _, r := range rows {
		resp.Roles = append(resp.Roles, toRoleResponse(r))
	}
	return c.JSON(resp)
}

func (h *AdminHandlers) createRole(c fiber.Ctx) error {
	var req adminCreateRoleRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := getValidator().Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	pids, err := parseUUIDs(req.PermissionIDs)
	if err != nil {
		return badRequest(c, "invalid_permission_id", err.Error())
	}
	role, err := h.roles.Create(c.Context(), repository.CreateRoleParams{
		Name:          req.Name,
		DisplayName:   req.DisplayName,
		Description:   req.Description,
		PermissionIDs: pids,
	})
	if err != nil {
		log.Error().Err(err).Msg("admin create role failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.Status(fiber.StatusCreated).JSON(toRoleResponse(*role))
}

func (h *AdminHandlers) updateRole(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", err.Error())
	}
	var req adminUpdateRoleRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := getValidator().Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}

	if req.DisplayName != nil || req.Description != nil {
		if err := h.roles.UpdateMeta(c.Context(), id, repository.UpdateRoleMeta{
			DisplayName: req.DisplayName,
			Description: req.Description,
		}); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "role_not_found"})
			}
			log.Error().Err(err).Msg("admin update role meta failed")
			return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
		}
	}

	if req.PermissionIDs != nil {
		pids, err := parseUUIDs(*req.PermissionIDs)
		if err != nil {
			return badRequest(c, "invalid_permission_id", err.Error())
		}
		if err := h.roles.UpdatePermissions(c.Context(), id, pids); err != nil {
			log.Error().Err(err).Msg("admin update role permissions failed")
			return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
		}
	}

	role, err := h.roles.FindByID(c.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "role_not_found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.JSON(toRoleResponse(*role))
}

func (h *AdminHandlers) deleteRole(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", err.Error())
	}
	role, err := h.roles.FindByID(c.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "role_not_found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	if role.IsSystem {
		return c.Status(fiber.StatusForbidden).JSON(errorResponse{Error: "system_role_protected"})
	}
	if err := h.roles.Delete(c.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "role_not_found"})
		}
		log.Error().Err(err).Msg("admin delete role failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *AdminHandlers) listPermissions(c fiber.Ctx) error {
	rows, err := h.roles.ListPermissions(c.Context())
	if err != nil {
		log.Error().Err(err).Msg("admin list permissions failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	resp := permissionsListResponse{
		Permissions: make([]permissionResponse, 0, len(rows)),
		Count:       len(rows),
	}
	for _, p := range rows {
		resp.Permissions = append(resp.Permissions, toPermissionResponse(p))
	}
	return c.JSON(resp)
}

// ── Helpers ────────────────────────────────────────────────────────────────

func toRoleResponse(r repository.Role) roleResponse {
	out := roleResponse{
		ID:          r.ID.String(),
		Name:        r.Name,
		DisplayName: r.DisplayName,
		Description: r.Description,
		IsSystem:    r.IsSystem,
		CreatedAt:   r.CreatedAt,
		Permissions: make([]permissionResponse, 0, len(r.Permissions)),
	}
	for _, p := range r.Permissions {
		out.Permissions = append(out.Permissions, toPermissionResponse(p))
	}
	return out
}

func toPermissionResponse(p repository.Permission) permissionResponse {
	return permissionResponse{
		ID:          p.ID.String(),
		Resource:    p.Resource,
		Action:      p.Action,
		Description: p.Description,
	}
}

func parseUUIDs(in []string) ([]uuid.UUID, error) {
	out := make([]uuid.UUID, 0, len(in))
	for _, s := range in {
		if s == "" {
			continue
		}
		id, err := uuid.Parse(s)
		if err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, nil
}
