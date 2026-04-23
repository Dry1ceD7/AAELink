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
	NATSURL     string
	JWTSecret   []byte
}

func Load() (*Config, error) {
	cfg := &Config{
		AppEnv:   getenv("APP_ENV", "development"),
		HTTPPort: getenv("TICKET_SERVICE_PORT", getenv("HTTP_PORT", "8002")),
		NATSURL:  getenv("NATS_URL", "nats://nats:4222"),
	}

	cfg.DatabaseURL = os.Getenv("TICKET_DATABASE_URL")
	if cfg.DatabaseURL == "" {
		cfg.DatabaseURL = os.Getenv("DATABASE_URL")
	}
	if cfg.DatabaseURL == "" {
		host := getenv("POSTGRES_HOST", "postgres")
		port := getenv("POSTGRES_PORT", "5432")
		user := getenv("POSTGRES_USER", "aaelink")
		pass := getenv("POSTGRES_PASSWORD", "")
		db := getenv("POSTGRES_DB_TICKET", "aaelink_tickets")
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

	return cfg, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
