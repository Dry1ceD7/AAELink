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
