package config

import (
	"errors"
	"fmt"
	"os"
)

type Config struct {
	AppEnv      string
	HTTPPort    string
	DatabaseURL string
	JWTSecret   []byte
}

func Load() (*Config, error) {
	cfg := &Config{
		AppEnv:   getenv("APP_ENV", "development"),
		HTTPPort: getenv("DOCUMENTS_SERVICE_PORT", getenv("HTTP_PORT", "8006")),
	}
	cfg.DatabaseURL = os.Getenv("DOCUMENTS_DATABASE_URL")
	if cfg.DatabaseURL == "" {
		cfg.DatabaseURL = os.Getenv("DATABASE_URL")
	}
	if cfg.DatabaseURL == "" {
		cfg.DatabaseURL = fmt.Sprintf(
			"postgres://%s:%s@%s:%s/%s?sslmode=disable",
			getenv("POSTGRES_USER", "aaelink"),
			getenv("POSTGRES_PASSWORD", ""),
			getenv("POSTGRES_HOST", "postgres"),
			getenv("POSTGRES_PORT", "5432"),
			getenv("POSTGRES_DB_DOCUMENTS", "aaelink_documents"),
		)
	}
	secret := getenv("JWT_SECRET", "")
	if len(secret) < 32 {
		return nil, errors.New("JWT_SECRET must be at least 32 characters")
	}
	cfg.JWTSecret = []byte(secret)
	return cfg, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
