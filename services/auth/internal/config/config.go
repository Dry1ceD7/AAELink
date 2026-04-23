package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	AppEnv     string
	HTTPPort   string
	DatabaseURL string

	JWTSecret     []byte
	JWTAccessTTL  time.Duration
	JWTRefreshTTL time.Duration
}

func Load() (*Config, error) {
	cfg := &Config{
		AppEnv:   getenv("APP_ENV", "development"),
		HTTPPort: getenv("AUTH_SERVICE_PORT", getenv("HTTP_PORT", "8001")),
	}

	cfg.DatabaseURL = os.Getenv("AUTH_DATABASE_URL")
	if cfg.DatabaseURL == "" {
		cfg.DatabaseURL = os.Getenv("DATABASE_URL")
	}
	if cfg.DatabaseURL == "" {
		host := getenv("POSTGRES_HOST", "postgres")
		port := getenv("POSTGRES_PORT", "5432")
		user := getenv("POSTGRES_USER", "aaelink")
		pass := getenv("POSTGRES_PASSWORD", "")
		db := getenv("POSTGRES_DB_AUTH", "aaelink_auth")
		cfg.DatabaseURL = fmt.Sprintf(
			"postgres://%s:%s@%s:%s/%s?sslmode=disable",
			user, pass, host, port, db,
		)
	}

	secret := getenv("JWT_SECRET", "")
	if len(secret) < 32 {
		return nil, errors.New("JWT_SECRET must be at least 32 characters")
	}
	cfg.JWTSecret = []byte(secret)

	access, err := time.ParseDuration(getenv("JWT_ACCESS_TTL", "15m"))
	if err != nil {
		return nil, fmt.Errorf("invalid JWT_ACCESS_TTL: %w", err)
	}
	cfg.JWTAccessTTL = access

	refresh, err := parseDurationDays(getenv("JWT_REFRESH_TTL", "7d"))
	if err != nil {
		return nil, fmt.Errorf("invalid JWT_REFRESH_TTL: %w", err)
	}
	cfg.JWTRefreshTTL = refresh

	return cfg, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// parseDurationDays accepts "7d", "24h", "30m" etc.
func parseDurationDays(s string) (time.Duration, error) {
	if len(s) > 1 && s[len(s)-1] == 'd' {
		n, err := strconv.Atoi(s[:len(s)-1])
		if err != nil {
			return 0, err
		}
		return time.Duration(n) * 24 * time.Hour, nil
	}
	return time.ParseDuration(s)
}
