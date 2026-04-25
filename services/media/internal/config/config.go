package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	AppEnv      string
	HTTPPort    string
	DatabaseURL string
	JWTSecret   []byte

	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOUseSSL    bool
	MinIOBucket    string
	PublicEndpoint string

	MaxUploadBytes int64
	MaxAvatarBytes int64
}

func Load() (*Config, error) {
	cfg := &Config{
		AppEnv:         getenv("APP_ENV", "development"),
		HTTPPort:       getenv("MEDIA_SERVICE_PORT", getenv("HTTP_PORT", "8004")),
		MinIOEndpoint:  getenv("MINIO_ENDPOINT", "minio:9000"),
		MinIOAccessKey: getenv("MINIO_ACCESS_KEY", "minioadmin"),
		MinIOSecretKey: getenv("MINIO_SECRET_KEY", "change_me_dev_only"),
		MinIOUseSSL:    strings.EqualFold(getenv("MINIO_USE_SSL", "false"), "true"),
		MinIOBucket:    getenv("MINIO_BUCKET_ATTACHMENTS", "aaelink-attachments"),
		PublicEndpoint: os.Getenv("MINIO_PUBLIC_ENDPOINT"),
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
		dbname := getenv("POSTGRES_DB_TICKET", "aaelink_tickets")
		cfg.DatabaseURL = fmt.Sprintf(
			"postgres://%s:%s@%s:%s/%s?sslmode=disable",
			user, pass, host, port, dbname,
		)
	}

	secret := getenv("JWT_SECRET", "")
	if len(secret) < 32 {
		return nil, errors.New("JWT_SECRET must be at least 32 characters")
	}
	cfg.JWTSecret = []byte(secret)

	maxMB := getenv("MEDIA_MAX_UPLOAD_MB", "200")
	mb, err := strconv.Atoi(maxMB)
	if err != nil || mb <= 0 {
		mb = 200
	}
	cfg.MaxUploadBytes = int64(mb) * 1024 * 1024

	avatarMB := getenv("MEDIA_MAX_AVATAR_MB", "20")
	amb, err := strconv.Atoi(avatarMB)
	if err != nil || amb <= 0 {
		amb = 20
	}
	cfg.MaxAvatarBytes = int64(amb) * 1024 * 1024

	return cfg, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
