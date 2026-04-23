package http

import "time"

type registerRequest struct {
	Email       string `json:"email" validate:"required,email,max=255"`
	Password    string `json:"password" validate:"required,min=8,max=128"`
	DisplayName string `json:"display_name" validate:"required,min=1,max=255"`
	Locale      string `json:"locale" validate:"omitempty,oneof=en th de"`
}

type loginRequest struct {
	Email    string `json:"email" validate:"required,email"`
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
	Email       string   `json:"email"        validate:"required,email,max=255"`
	Password    string   `json:"password"     validate:"required,min=8,max=128"`
	DisplayName string   `json:"display_name" validate:"required,min=1,max=255"`
	Locale      string   `json:"locale"       validate:"omitempty,oneof=en th de"`
	Roles       []string `json:"roles"        validate:"omitempty,dive,oneof=it_admin it_employee employee"`
	IsActive    *bool    `json:"is_active"`
}

type adminUpdateRolesRequest struct {
	Roles []string `json:"roles" validate:"required,min=1,dive,oneof=it_admin it_employee employee"`
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
