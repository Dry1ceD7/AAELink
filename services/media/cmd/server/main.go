package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/Dry1ceD7/AAELink/services/media/internal/config"
	"github.com/Dry1ceD7/AAELink/services/media/internal/db"
	mediahttp "github.com/Dry1ceD7/AAELink/services/media/internal/http"
	"github.com/Dry1ceD7/AAELink/services/media/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/media/internal/security"
	"github.com/Dry1ceD7/AAELink/services/media/internal/storage"
)

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if os.Getenv("APP_ENV") == "development" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("config load")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	store, err := storage.New(ctx, storage.Options{
		Endpoint:       cfg.MinIOEndpoint,
		AccessKey:      cfg.MinIOAccessKey,
		SecretKey:      cfg.MinIOSecretKey,
		UseSSL:         cfg.MinIOUseSSL,
		Bucket:         cfg.MinIOBucket,
		PublicEndpoint: cfg.PublicEndpoint,
	})
	if err != nil {
		log.Fatal().Err(err).Msg("minio init")
	}

	repo := repository.NewFileRepo(pool)
	verifier := security.NewVerifier(cfg.JWTSecret)
	handlers := mediahttp.NewHandlers(repo, store, cfg.MaxUploadBytes)

	app := fiber.New(fiber.Config{
		AppName:      "AAELink Media Service v0.1.0",
		ErrorHandler: errorHandler,
		BodyLimit:    int(cfg.MaxUploadBytes) + 10*1024*1024,
	})

	app.Get("/health", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "media",
			"version": "0.1.0",
		})
	})
	app.Get("/metrics", func(c fiber.Ctx) error {
		return c.SendString("# AAELink media metrics\n")
	})

	mediahttp.RegisterRoutes(app, handlers, verifier)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info().Str("port", cfg.HTTPPort).Str("bucket", cfg.MinIOBucket).Msg("media service starting")
		if err := app.Listen(":" + cfg.HTTPPort); err != nil {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	<-quit
	log.Info().Msg("shutting down media service")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := app.ShutdownWithContext(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("shutdown error")
	}
}

func errorHandler(c fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}
	return c.Status(code).JSON(fiber.Map{
		"error": err.Error(),
		"code":  code,
	})
}
