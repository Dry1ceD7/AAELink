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

	"github.com/Dry1ceD7/AAELink/services/auth/internal/config"
	"github.com/Dry1ceD7/AAELink/services/auth/internal/db"
	authhttp "github.com/Dry1ceD7/AAELink/services/auth/internal/http"
	"github.com/Dry1ceD7/AAELink/services/auth/internal/metrics"
	"github.com/Dry1ceD7/AAELink/services/auth/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/auth/internal/security"
	"github.com/Dry1ceD7/AAELink/services/auth/internal/service"
)

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if os.Getenv("APP_ENV") == "development" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("config load failed")
	}

	ctx := context.Background()
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect failed")
	}
	defer pool.Close()

	tokens := security.NewTokenIssuer(cfg.JWTSecret, cfg.JWTAccessTTL, cfg.JWTRefreshTTL)
	users := repository.NewUserRepository(pool)
	sessions := repository.NewSessionRepository(pool)
	authSvc := service.New(users, sessions, tokens)
	handlers := authhttp.NewHandlers(authSvc, tokens)

	app := fiber.New(fiber.Config{
		AppName:      "AAELink Auth Service v0.1.0",
		ErrorHandler: errorHandler,
	})

	app.Use(metrics.Middleware("auth"))

	app.Get("/health", func(c fiber.Ctx) error {
		if err := pool.Ping(c.Context()); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"status":  "unhealthy",
				"service": "auth",
				"error":   err.Error(),
			})
		}
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "auth",
			"version": "0.1.0",
		})
	})

	app.Get("/metrics", metrics.Handler())

	handlers.Register(app)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info().Str("port", cfg.HTTPPort).Msg("auth service starting")
		if err := app.Listen(":" + cfg.HTTPPort); err != nil {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	<-quit
	log.Info().Msg("shutting down auth service")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
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
