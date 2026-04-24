package service

import (
	"context"
	"errors"
	"os"
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
	depts    *repository.DepartmentRepository
	tokens   *security.TokenIssuer
}

func New(
	users *repository.UserRepository,
	sessions *repository.SessionRepository,
	depts *repository.DepartmentRepository,
	tokens *security.TokenIssuer,
) *AuthService {
	return &AuthService{users: users, sessions: sessions, depts: depts, tokens: tokens}
}

type RegisterInput struct {
	Email        string
	Password     string
	DisplayName  string
	Locale       string
	DepartmentID *uuid.UUID
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

// defaultLoginDomain is appended to bare usernames so admins can log in with
// just "Adminaaelink" / "Adminaaelink2026" instead of typing the full email
// address. Set the SUPER_ADMIN_DOMAIN env var to override per deployment.
func defaultLoginDomain() string {
	if v := strings.TrimSpace(os.Getenv("SUPER_ADMIN_DOMAIN")); v != "" {
		return strings.ToLower(v)
	}
	return "aae.co.th"
}

func normalizeEmail(e string) string {
	return strings.ToLower(strings.TrimSpace(e))
}

// normalizeLogin lets users sign in with either a username
// ("adminaaelink") or a full email ("Adminaaelink@aae.co.th"). Bare
// usernames are mapped onto the configured tenant domain so the rest of
// the auth pipeline (which is email-keyed) does not need to change.
func normalizeLogin(input string) string {
	v := strings.ToLower(strings.TrimSpace(input))
	if v == "" {
		return v
	}
	if !strings.Contains(v, "@") {
		v = v + "@" + defaultLoginDomain()
	}
	return v
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

	user, err := s.users.Create(ctx, email, hash, in.DisplayName, locale, in.DepartmentID)
	if err != nil {
		return nil, err
	}
	if err := s.users.AssignDefaultRole(ctx, user.ID); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *AuthService) Login(ctx context.Context, in LoginInput) (*AuthResult, error) {
	email := normalizeLogin(in.Email)
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

// UpdateSelfProfile lets a logged-in user patch their own non-privileged
// fields. Email and roles are intentionally not exposed here.
func (s *AuthService) UpdateSelfProfile(
	ctx context.Context,
	userID uuid.UUID,
	displayName, preferredLocale, avatarURL *string,
	clearAvatar bool,
) error {
	return s.users.UpdateProfile(ctx, userID, repository.UpdateProfileParams{
		DisplayName:     displayName,
		PreferredLocale: preferredLocale,
		AvatarURL:       avatarURL,
		ClearAvatar:     clearAvatar,
	})
}

// ChangeOwnPassword verifies the current password before persisting the new one.
func (s *AuthService) ChangeOwnPassword(ctx context.Context, userID uuid.UUID, current, next string) error {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	if err := security.VerifyPassword(current, user.PasswordHash); err != nil {
		return ErrInvalidCredentials
	}
	hash, err := security.HashPassword(next)
	if err != nil {
		return err
	}
	return s.users.UpdatePasswordHash(ctx, userID, hash)
}

func (s *AuthService) issueTokens(ctx context.Context, user *repository.User, ip, ua string) (*TokenPair, error) {
	roles, err := s.users.FindRoles(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	access, accessExp, err := s.tokens.IssueAccess(user.ID, user.Email, security.AccessClaims{
		Roles:        roles,
		DepartmentID: user.DepartmentID,
		IsITDept:     s.isITDepartment(ctx, user.DepartmentID),
	})
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

// isITDepartment returns true if the supplied department is flagged as the
// IT department. Failures are treated as non-IT — the safer default for
// downstream isolation checks.
func (s *AuthService) isITDepartment(ctx context.Context, deptID *uuid.UUID) bool {
	if deptID == nil || s.depts == nil {
		return false
	}
	d, err := s.depts.FindByID(ctx, *deptID)
	if err != nil || d == nil {
		return false
	}
	return d.IsITDept
}
