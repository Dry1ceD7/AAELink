package http

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/Dry1ceD7/AAELink/services/auth/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/auth/internal/security"
	"github.com/Dry1ceD7/AAELink/services/auth/internal/service"
)

// AdminHandlers exposes user-management endpoints restricted to it_admin.
type AdminHandlers struct {
	users *repository.UserRepository
	depts *repository.DepartmentRepository
	roles *repository.RoleRepository
	auth  *service.AuthService
}

func NewAdminHandlers(
	users *repository.UserRepository,
	depts *repository.DepartmentRepository,
	roles *repository.RoleRepository,
	auth *service.AuthService,
) *AdminHandlers {
	return &AdminHandlers{users: users, depts: depts, roles: roles, auth: auth}
}

// Register mounts the admin routes onto the given parent group.
// The caller is responsible for installing AuthRequired + RequireRole middlewares.
func (h *AdminHandlers) Register(g fiber.Router) {
	g.Get("/users", h.listUsers)
	g.Post("/users", h.createUser)
	g.Patch("/users/:id", h.updateUser)
	g.Patch("/users/:id/password", h.updatePassword)
	g.Patch("/users/:id/roles", h.updateRoles)
	g.Patch("/users/:id/active", h.setActive)
	g.Delete("/users/:id", h.deleteUser)

	g.Get("/departments", h.listDepartments)
	g.Post("/departments", h.createDepartment)
	g.Patch("/departments/:id", h.updateDepartment)
	g.Delete("/departments/:id", h.deleteDepartment)

	g.Get("/roles", h.listRoles)
	g.Post("/roles", h.createRole)
	g.Patch("/roles/:id", h.updateRole)
	g.Delete("/roles/:id", h.deleteRole)

	g.Get("/permissions", h.listPermissions)
}

func (h *AdminHandlers) listUsers(c fiber.Ctx) error {
	rows, err := h.users.ListAll(c.Context(), 200, 0)
	if err != nil {
		log.Error().Err(err).Msg("admin list users failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	resp := adminUsersListResponse{
		Users: make([]adminUserResponse, 0, len(rows)),
		Count: len(rows),
	}
	for _, u := range rows {
		resp.Users = append(resp.Users, toAdminUser(u))
	}
	return c.JSON(resp)
}

func (h *AdminHandlers) createUser(c fiber.Ctx) error {
	var req adminCreateUserRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	// Reuse the same validator instance from the auth handlers package:
	if err := getValidator().Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}

	var deptID *uuid.UUID
	if req.DepartmentID != nil && *req.DepartmentID != "" {
		dID, perr := uuid.Parse(*req.DepartmentID)
		if perr != nil {
			return badRequest(c, "invalid_department_id", perr.Error())
		}
		deptID = &dID
	}
	user, err := h.auth.Register(c.Context(), service.RegisterInput{
		Email:        req.Email,
		Password:     req.Password,
		DisplayName:  req.DisplayName,
		Locale:       req.Locale,
		DepartmentID: deptID,
	})
	if errors.Is(err, service.ErrEmailTaken) {
		return c.Status(fiber.StatusConflict).JSON(errorResponse{Error: "email_taken"})
	}
	if err != nil {
		log.Error().Err(err).Msg("admin create user failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}

	roles := req.Roles
	if len(roles) == 0 {
		roles = []string{"employee"}
	}
	if err := h.users.ReplaceRoles(c.Context(), user.ID, roles); err != nil {
		log.Error().Err(err).Msg("admin assign roles failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	if req.IsActive != nil {
		if err := h.users.SetActive(c.Context(), user.ID, *req.IsActive); err != nil {
			log.Error().Err(err).Msg("admin set active failed")
		}
	}

	final, err := h.users.FindByID(c.Context(), user.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	finalRoles, _ := h.users.FindRoles(c.Context(), user.ID)
	return c.Status(fiber.StatusCreated).JSON(toAdminUser(repository.UserWithRoles{
		User: *final, Roles: finalRoles,
	}))
}

func (h *AdminHandlers) updateRoles(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", err.Error())
	}
	var req adminUpdateRolesRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := getValidator().Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	// Force the canonical super_admin role to remain on the platform
	// super-admin identity. The is_super_admin flag is the source of
	// truth; we just keep the role list aligned for consistency.
	if target, err := h.users.FindByID(c.Context(), id); err == nil && target != nil && target.IsSuperAdmin {
		req.Roles = ensureRole(req.Roles, service.SuperAdminRoleName)
	}
	if err := h.users.ReplaceRoles(c.Context(), id, req.Roles); err != nil {
		log.Error().Err(err).Msg("admin update roles failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	user, err := h.users.FindByID(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "user_not_found"})
	}
	roles, _ := h.users.FindRoles(c.Context(), id)
	return c.JSON(toAdminUser(repository.UserWithRoles{User: *user, Roles: roles}))
}

func ensureRole(roles []string, want string) []string {
	for _, r := range roles {
		if r == want {
			return roles
		}
	}
	return append(roles, want)
}

func (h *AdminHandlers) setActive(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", err.Error())
	}
	var req adminSetActiveRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if !req.IsActive {
		if target, err := h.users.FindByID(c.Context(), id); err == nil && target != nil && target.IsSuperAdmin {
			return c.Status(fiber.StatusBadRequest).JSON(errorResponse{Error: "cannot_deactivate_super_admin"})
		}
	}
	if err := h.users.SetActive(c.Context(), id, req.IsActive); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "user_not_found"})
		}
		log.Error().Err(err).Msg("admin set active failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	user, err := h.users.FindByID(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	roles, _ := h.users.FindRoles(c.Context(), id)
	return c.JSON(toAdminUser(repository.UserWithRoles{User: *user, Roles: roles}))
}

func toAdminUser(u repository.UserWithRoles) adminUserResponse {
	resp := adminUserResponse{
		ID:              u.ID.String(),
		Email:           u.Email,
		DisplayName:     u.DisplayName,
		PreferredLocale: u.PreferredLocale,
		IsActive:        u.IsActive,
		IsSuperAdmin:    u.IsSuperAdmin,
		Roles:           u.Roles,
		AvatarURL:       u.AvatarURL,
		CreatedAt:       u.CreatedAt,
		UpdatedAt:       u.UpdatedAt,
	}
	if u.DepartmentID != nil {
		v := u.DepartmentID.String()
		resp.DepartmentID = &v
	}
	return resp
}

func (h *AdminHandlers) updateUser(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", err.Error())
	}
	var req adminUpdateUserRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := getValidator().Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}

	params := repository.UpdateProfileParams{
		DisplayName:     req.DisplayName,
		PreferredLocale: req.PreferredLocale,
		ClearDepartment: req.ClearDepartment,
	}
	if req.Email != nil {
		v := strings.ToLower(strings.TrimSpace(*req.Email))
		params.Email = &v
	}
	if req.DepartmentID != nil && !req.ClearDepartment {
		dID, err := uuid.Parse(*req.DepartmentID)
		if err != nil {
			return badRequest(c, "invalid_department_id", err.Error())
		}
		params.DepartmentID = &dID
	}

	if err := h.users.UpdateProfile(c.Context(), id, params); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "user_not_found"})
		}
		log.Error().Err(err).Msg("admin update user failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return h.respondUser(c, id)
}

func (h *AdminHandlers) updatePassword(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", err.Error())
	}
	var req adminUpdatePasswordRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := getValidator().Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	hash, err := security.HashPassword(req.Password)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	if err := h.users.UpdatePasswordHash(c.Context(), id, hash); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "user_not_found"})
		}
		log.Error().Err(err).Msg("admin update password failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *AdminHandlers) deleteUser(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", err.Error())
	}
	// Prevent self-deletion lockout.
	if uid, err := userIDFromCtx(c); err == nil && uid == id {
		return c.Status(fiber.StatusBadRequest).JSON(errorResponse{Error: "cannot_delete_self"})
	}
	// Refuse to soft-delete the platform super-admin: doing so would
	// remove the only account guaranteed to retain cross-departmental
	// oversight.
	if target, err := h.users.FindByID(c.Context(), id); err == nil && target != nil && target.IsSuperAdmin {
		return c.Status(fiber.StatusBadRequest).JSON(errorResponse{Error: "cannot_delete_super_admin"})
	}
	if err := h.users.SoftDelete(c.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "user_not_found"})
		}
		log.Error().Err(err).Msg("admin delete user failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *AdminHandlers) respondUser(c fiber.Ctx, id uuid.UUID) error {
	user, err := h.users.FindByID(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "user_not_found"})
	}
	roles, _ := h.users.FindRoles(c.Context(), id)
	return c.JSON(toAdminUser(repository.UserWithRoles{User: *user, Roles: roles}))
}

// ── Departments ────────────────────────────────────────────────────────────

func (h *AdminHandlers) listDepartments(c fiber.Ctx) error {
	rows, err := h.depts.List(c.Context())
	if err != nil {
		log.Error().Err(err).Msg("admin list departments failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	resp := departmentsListResponse{
		Departments: make([]departmentResponse, 0, len(rows)),
		Count:       len(rows),
	}
	for _, d := range rows {
		resp.Departments = append(resp.Departments, toDepartment(d))
	}
	return c.JSON(resp)
}

func (h *AdminHandlers) createDepartment(c fiber.Ctx) error {
	var req adminCreateDepartmentRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := getValidator().Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	d, err := h.depts.Create(c.Context(), repository.CreateDepartmentParams{
		Slug: strings.ToLower(strings.TrimSpace(req.Slug)),
		Name: req.Name, IsITDept: req.IsITDept,
	})
	if err != nil {
		log.Error().Err(err).Msg("admin create department failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.Status(fiber.StatusCreated).JSON(toDepartment(*d))
}

func (h *AdminHandlers) updateDepartment(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", err.Error())
	}
	var req adminUpdateDepartmentRequest
	if err := c.Bind().JSON(&req); err != nil {
		return badRequest(c, "invalid_body", err.Error())
	}
	if err := getValidator().Struct(&req); err != nil {
		return badRequest(c, "validation_failed", err.Error())
	}
	params := repository.UpdateDepartmentParams{
		Name:     req.Name,
		IsITDept: req.IsITDept,
	}
	if req.Slug != nil {
		v := strings.ToLower(strings.TrimSpace(*req.Slug))
		params.Slug = &v
	}
	if err := h.depts.Update(c.Context(), id, params); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "department_not_found"})
		}
		log.Error().Err(err).Msg("admin update department failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	d, err := h.depts.FindByID(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.JSON(toDepartment(*d))
}

func (h *AdminHandlers) deleteDepartment(c fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return badRequest(c, "invalid_id", err.Error())
	}
	if err := h.depts.Delete(c.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorResponse{Error: "department_not_found"})
		}
		log.Error().Err(err).Msg("admin delete department failed")
		return c.Status(fiber.StatusInternalServerError).JSON(errorResponse{Error: "internal_error"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func toDepartment(d repository.Department) departmentResponse {
	return departmentResponse{
		ID:        d.ID.String(),
		Slug:      d.Slug,
		Name:      d.Name,
		IsITDept:  d.IsITDept,
		CreatedAt: d.CreatedAt,
		UpdatedAt: d.UpdatedAt,
	}
}
