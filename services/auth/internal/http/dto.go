package http

import "time"

type registerRequest struct {
	Email       string `json:"email" validate:"required,email,max=255"`
	Password    string `json:"password" validate:"required,min=8,max=128"`
	DisplayName string `json:"display_name" validate:"required,min=1,max=255"`
	Locale      string `json:"locale" validate:"omitempty,oneof=en th de"`
}

// loginRequest accepts either a full email ("admin@aaelink.local") or a
// bare username ("Admin"). The auth service appends the default tenant
// domain to bare usernames before lookup.
type loginRequest struct {
	Email    string `json:"email" validate:"required,min=2,max=255"`
	Password string `json:"password" validate:"required"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

type logoutRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

type userResponse struct {
	ID              string   `json:"id"`
	Email           string   `json:"email"`
	DisplayName     string   `json:"display_name"`
	PreferredLocale string   `json:"preferred_locale"`
	IsActive        bool     `json:"is_active"`
	Roles           []string `json:"roles,omitempty"`
	AvatarURL       *string  `json:"avatar_url,omitempty"`
	DepartmentID    *string  `json:"department_id,omitempty"`
}

type updateMeRequest struct {
	DisplayName     *string `json:"display_name"     validate:"omitempty,min=1,max=255"`
	PreferredLocale *string `json:"preferred_locale" validate:"omitempty,oneof=en th de"`
	AvatarURL       *string `json:"avatar_url"       validate:"omitempty,max=500"`
	ClearAvatar     bool    `json:"clear_avatar"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password" validate:"required,min=8,max=128"`
	NewPassword     string `json:"new_password"     validate:"required,min=8,max=128"`
}

type tokenResponse struct {
	AccessToken      string    `json:"access_token"`
	RefreshToken     string    `json:"refresh_token"`
	TokenType        string    `json:"token_type"`
	AccessExpiresAt  time.Time `json:"access_expires_at"`
	RefreshExpiresAt time.Time `json:"refresh_expires_at"`
}

type authResponse struct {
	User   userResponse  `json:"user"`
	Tokens tokenResponse `json:"tokens"`
}

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

// ── Admin DTOs ───────────────────────────────────────────────────────────────

type adminCreateUserRequest struct {
	Email        string   `json:"email"         validate:"required,email,max=255"`
	Password     string   `json:"password"      validate:"required,min=8,max=128"`
	DisplayName  string   `json:"display_name"  validate:"required,min=1,max=255"`
	Locale       string   `json:"locale"        validate:"omitempty,oneof=en th de"`
	// Roles accepts any role name registered in the database, so admins
	// can assign custom roles created via /api/v1/admin/roles. The role
	// itself is validated against the roles table when applied.
	Roles        []string `json:"roles"         validate:"omitempty,dive,min=1,max=64"`
	IsActive     *bool    `json:"is_active"`
	DepartmentID *string  `json:"department_id" validate:"omitempty,uuid"`
}

type adminUpdateRolesRequest struct {
	Roles []string `json:"roles" validate:"required,min=1,dive,min=1,max=64"`
}

type adminSetActiveRequest struct {
	IsActive bool `json:"is_active"`
}

type adminUserResponse struct {
	ID              string    `json:"id"`
	Email           string    `json:"email"`
	DisplayName     string    `json:"display_name"`
	PreferredLocale string    `json:"preferred_locale"`
	IsActive        bool      `json:"is_active"`
	Roles           []string  `json:"roles"`
	DepartmentID    *string   `json:"department_id,omitempty"`
	AvatarURL       *string   `json:"avatar_url,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type adminUsersListResponse struct {
	Users []adminUserResponse `json:"users"`
	Count int                 `json:"count"`
}

type adminUpdateUserRequest struct {
	Email           *string `json:"email"            validate:"omitempty,email,max=255"`
	DisplayName     *string `json:"display_name"     validate:"omitempty,min=1,max=255"`
	PreferredLocale *string `json:"preferred_locale" validate:"omitempty,oneof=en th de"`
	DepartmentID    *string `json:"department_id"    validate:"omitempty,uuid"`
	ClearDepartment bool    `json:"clear_department"`
}

type adminUpdatePasswordRequest struct {
	Password string `json:"password" validate:"required,min=8,max=128"`
}

// ── Department DTOs ──────────────────────────────────────────────────────────

type departmentResponse struct {
	ID        string            `json:"id"`
	Slug      string            `json:"slug"`
	Name      map[string]string `json:"name"`
	IsITDept  bool              `json:"is_it_dept"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
}

type departmentsListResponse struct {
	Departments []departmentResponse `json:"departments"`
	Count       int                  `json:"count"`
}

type adminCreateDepartmentRequest struct {
	Slug     string            `json:"slug" validate:"required,min=2,max=100"`
	Name     map[string]string `json:"name" validate:"required,min=1,dive,keys,oneof=en th de,endkeys,required,min=1,max=200"`
	IsITDept bool              `json:"is_it_dept"`
}

type adminUpdateDepartmentRequest struct {
	Slug     *string           `json:"slug"        validate:"omitempty,min=2,max=100"`
	Name     map[string]string `json:"name"        validate:"omitempty,dive,keys,oneof=en th de,endkeys,required,min=1,max=200"`
	IsITDept *bool             `json:"is_it_dept"`
}

// ── Role / Permission DTOs ──────────────────────────────────────────────────

type permissionResponse struct {
	ID          string `json:"id"`
	Resource    string `json:"resource"`
	Action      string `json:"action"`
	Description string `json:"description,omitempty"`
}

type permissionsListResponse struct {
	Permissions []permissionResponse `json:"permissions"`
	Count       int                  `json:"count"`
}

type roleResponse struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	DisplayName map[string]string    `json:"display_name"`
	Description string               `json:"description,omitempty"`
	IsSystem    bool                 `json:"is_system"`
	CreatedAt   time.Time            `json:"created_at"`
	Permissions []permissionResponse `json:"permissions"`
}

type rolesListResponse struct {
	Roles []roleResponse `json:"roles"`
	Count int            `json:"count"`
}

type adminCreateRoleRequest struct {
	Name          string            `json:"name"           validate:"required,min=2,max=64"`
	DisplayName   map[string]string `json:"display_name"   validate:"required,min=1,dive,keys,oneof=en th de,endkeys,required,min=1,max=200"`
	Description   string            `json:"description"    validate:"omitempty,max=500"`
	PermissionIDs []string          `json:"permission_ids" validate:"omitempty,dive,uuid"`
}

type adminUpdateRoleRequest struct {
	DisplayName   map[string]string `json:"display_name"   validate:"omitempty,dive,keys,oneof=en th de,endkeys,required,min=1,max=200"`
	Description   *string           `json:"description"    validate:"omitempty,max=500"`
	PermissionIDs *[]string         `json:"permission_ids" validate:"omitempty,dive,uuid"`
}
