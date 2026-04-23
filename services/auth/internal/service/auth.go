package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Dry1ceD7/AAELink/services/auth/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/auth/internal/security"
)

var (
	ErrEmailTaken         = errors.New("email already registered")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrInactiveUser       = errors.New("user inactive")
	ErrInvalidRefresh     = errors.New("invalid refresh token")
)

type AuthService struct {
	users    *repository.UserRepository
	sessions *repository.SessionRepository
	tokens   *security.TokenIssuer
}

func New(users *repository.UserRepository, sessions *repository.SessionRepository, tokens *security.TokenIssuer) *AuthService {
	return &AuthService{users: users, sessions: sessions, tokens: tokens}
}

type RegisterInput struct {
	Email       string
	Password    string
	DisplayName string
	Locale      string
}

type LoginInput struct {
	Email     string
	Password  string
	IP        string
	UserAgent string
}

type TokenPair struct {
	AccessToken  string
	RefreshToken string
	AccessExp    time.Time
	RefreshExp   time.Time
}

type AuthResult struct {
	User   *repository.User
	Roles  []string
	Tokens TokenPair
}

func normalizeEmail(e string) string {
	return strings.ToLower(strings.TrimSpace(e))
}

func (s *AuthService) Register(ctx context.Context, in RegisterInput) (*repository.User, error) {
	email := normalizeEmail(in.Email)
	if existing, err := s.users.FindByEmail(ctx, email); err == nil && existing != nil {
		return nil, ErrEmailTaken
	} else if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return nil, err
	}

	hash, err := security.HashPassword(in.Password)
	if err != nil {
		return nil, err
	}

	locale := in.Locale
	if locale == "" {
		locale = "en"
	}

	user, err := s.users.Create(ctx, email, hash, in.DisplayName, locale, nil)
	if err != nil {
		return nil, err
	}
	if err := s.users.AssignDefaultRole(ctx, user.ID); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *AuthService) Login(ctx context.Context, in LoginInput) (*AuthResult, error) {
	email := normalizeEmail(in.Email)
	user, err := s.users.FindByEmail(ctx, email)
	if errors.Is(err, repository.ErrNotFound) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if !user.IsActive {
		return nil, ErrInactiveUser
	}
	if err := security.VerifyPassword(in.Password, user.PasswordHash); err != nil {
		return nil, ErrInvalidCredentials
	}

	tokens, err := s.issueTokens(ctx, user, in.IP, in.UserAgent)
	if err != nil {
		return nil, err
	}

	roles, err := s.users.FindRoles(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	return &AuthResult{User: user, Roles: roles, Tokens: *tokens}, nil
}

// Refresh rotates the refresh token. Old token is deleted, new pair returned.
func (s *AuthService) Refresh(ctx context.Context, refreshToken, ip, ua string) (*AuthResult, error) {
	hash := security.HashRefreshToken(refreshToken)
	sess, err := s.sessions.FindByTokenHash(ctx, hash)
	if errors.Is(err, repository.ErrNotFound) {
		return nil, ErrInvalidRefresh
	}
	if err != nil {
		return nil, err
	}
	if sess.ExpiresAt.Before(time.Now().UTC()) {
		_ = s.sessions.DeleteByTokenHash(ctx, hash)
		return nil, ErrInvalidRefresh
	}

	user, err := s.users.FindByID(ctx, sess.UserID)
	if err != nil {
		return nil, err
	}
	if !user.IsActive {
		_ = s.sessions.DeleteByTokenHash(ctx, hash)
		return nil, ErrInactiveUser
	}

	if err := s.sessions.DeleteByTokenHash(ctx, hash); err != nil {
		return nil, err
	}

	tokens, err := s.issueTokens(ctx, user, ip, ua)
	if err != nil {
		return nil, err
	}
	roles, err := s.users.FindRoles(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	return &AuthResult{User: user, Roles: roles, Tokens: *tokens}, nil
}

func (s *AuthService) Logout(ctx context.Context, refreshToken string) error {
	hash := security.HashRefreshToken(refreshToken)
	return s.sessions.DeleteByTokenHash(ctx, hash)
}

func (s *AuthService) Me(ctx context.Context, userID uuid.UUID) (*repository.User, []string, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	roles, err := s.users.FindRoles(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	return user, roles, nil
}

func (s *AuthService) issueTokens(ctx context.Context, user *repository.User, ip, ua string) (*TokenPair, error) {
	access, accessExp, err := s.tokens.IssueAccess(user.ID, user.Email)
	if err != nil {
		return nil, err
	}

	refresh, refreshHash, err := security.NewRefreshToken()
	if err != nil {
		return nil, err
	}
	refreshExp := time.Now().UTC().Add(s.tokens.RefreshTTL())
	if _, err := s.sessions.Create(ctx, user.ID, refreshHash, refreshExp, ip, ua); err != nil {
		return nil, err
	}

	return &TokenPair{
		AccessToken:  access,
		RefreshToken: refresh,
		AccessExp:    accessExp,
		RefreshExp:   refreshExp,
	}, nil
}
