package service

import (
	"context"
	"errors"
	"os"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/Dry1ceD7/AAELink/services/auth/internal/repository"
)

// BootstrapOptions controls how the default super-admin is provisioned.
type BootstrapOptions struct {
	Email       string // e.g. Adminaaelink@aae.co.th
	Password    string // e.g. Adminaaelink2026
	DisplayName string // e.g. AAELink Administrator
	Locale      string // e.g. en
	// ResetPassword forces the seeded password back to the configured value
	// even if the account already exists. Useful for shared test
	// environments where the credentials must always match the documented
	// defaults.
	ResetPassword bool
	// LegacyEmails is a list of historical admin email addresses that must
	// be removed on every start. This guarantees that obsolete credentials
	// (e.g. left over from prior deployments) cannot be used to sign in.
	LegacyEmails []string
}

// EnsureSuperAdmin idempotently provisions the default super administrator
// account so engineers and customers can always sign in with the documented
// credentials. The function is safe to call on every service start.
func (s *AuthService) EnsureSuperAdmin(ctx context.Context, opts BootstrapOptions) error {
	email := normalizeEmail(opts.Email)
	if email == "" {
		return errors.New("super admin email is empty")
	}
	if opts.Password == "" {
		return errors.New("super admin password is empty")
	}

	// Purge legacy admin accounts so they cannot be used to sign in.
	for _, legacy := range opts.LegacyEmails {
		legacy = normalizeEmail(legacy)
		if legacy == "" || legacy == email {
			continue
		}
		old, lookupErr := s.users.FindByEmail(ctx, legacy)
		if errors.Is(lookupErr, repository.ErrNotFound) {
			continue
		}
		if lookupErr != nil {
			log.Warn().Err(lookupErr).Str("email", legacy).Msg("legacy admin lookup failed")
			continue
		}
		if err := s.users.SoftDelete(ctx, old.ID); err != nil {
			log.Warn().Err(err).Str("email", legacy).Msg("legacy admin removal failed")
			continue
		}
		log.Info().Str("email", legacy).Msg("legacy admin removed")
	}

	existing, err := s.users.FindByEmail(ctx, email)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return err
	}

	if existing == nil {
		log.Info().Str("email", email).Msg("seeding default super-admin account")
		user, err := s.Register(ctx, RegisterInput{
			Email:       email,
			Password:    opts.Password,
			DisplayName: opts.DisplayName,
			Locale:      opts.Locale,
		})
		if err != nil {
			return err
		}
		// Replace the auto-assigned 'employee' role with the it_admin role
		// so the bootstrap account always has full administrative access.
		if err := s.users.ReplaceRoles(ctx, user.ID, []string{"it_admin"}); err != nil {
			return err
		}
		return nil
	}

	// Account exists — make sure it is active and has the it_admin role.
	if !existing.IsActive {
		if err := s.users.SetActive(ctx, existing.ID, true); err != nil {
			return err
		}
	}
	if err := s.users.AssignRoleByName(ctx, existing.ID, "it_admin"); err != nil {
		return err
	}

	if opts.ResetPassword {
		log.Info().Str("email", email).Msg("resetting super-admin password to the documented default")
		hash, err := hashSeedPassword(opts.Password)
		if err != nil {
			return err
		}
		if err := s.users.UpdatePasswordHash(ctx, existing.ID, hash); err != nil {
			return err
		}
	}
	return nil
}

// hashSeedPassword wraps security.HashPassword so this file does not need to
// import the security package directly (kept thin for testability).
var hashSeedPassword = func(pw string) (string, error) {
	return passwordHasher(pw)
}

// passwordHasher is initialised in init.go to avoid an import cycle with the
// security package. It is settable so tests can substitute a faster hasher.
var passwordHasher func(string) (string, error)

// SuperAdminFromEnv reads bootstrap settings from the standard env vars.
// Defaults match the documented test credentials so the account is always
// available out of the box.
func SuperAdminFromEnv() BootstrapOptions {
	legacy := strings.Split(getenv("SUPER_ADMIN_LEGACY_EMAILS", "admin@aaelink.local,admin@aae.local"), ",")
	for i := range legacy {
		legacy[i] = strings.TrimSpace(legacy[i])
	}
	return BootstrapOptions{
		Email:         strings.ToLower(getenv("SUPER_ADMIN_EMAIL", "Adminaaelink@aae.co.th")),
		Password:      getenv("SUPER_ADMIN_PASSWORD", "Adminaaelink2026"),
		DisplayName:   getenv("SUPER_ADMIN_DISPLAY_NAME", "AAELink Administrator"),
		Locale:        getenv("SUPER_ADMIN_LOCALE", "en"),
		ResetPassword: getenv("SUPER_ADMIN_RESET_PASSWORD", "true") == "true",
		LegacyEmails:  legacy,
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
