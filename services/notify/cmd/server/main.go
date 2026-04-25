package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/Dry1ceD7/AAELink/services/notify/internal/config"
	"github.com/Dry1ceD7/AAELink/services/notify/internal/consumer"
	"github.com/Dry1ceD7/AAELink/services/notify/internal/mailer"
	"github.com/Dry1ceD7/AAELink/services/notify/internal/metrics"
	"github.com/Dry1ceD7/AAELink/services/notify/internal/users"
)

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	cfg := config.Load()
	if cfg.Env == "development" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	m := mailer.New(mailer.Config{
		Host:     cfg.SMTPHost,
		Port:     cfg.SMTPPort,
		Username: cfg.SMTPUser,
		Password: cfg.SMTPPassword,
		From:     cfg.SMTPFrom,
		StartTLS: cfg.SMTPStartTLS,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Best-effort connection to the auth database for verified-email
	// routing. If the DSN is missing or the DB is unreachable we still
	// boot the worker — events will fall back to the legacy inbox so the
	// pipeline never silently drops messages.
	resolver, closeResolver, err := users.New(ctx, cfg.AuthDatabaseURL)
	if err != nil {
		log.Warn().Err(err).Msg("auth database unavailable; falling back to NOTIFY_INBOX only")
		resolver = nil
		closeResolver = func() {}
	}
	defer closeResolver()

	worker := consumer.New(consumer.Options{
		URL:          cfg.NATSUrl,
		Stream:       cfg.NATSStream,
		Subject:      cfg.NATSSubject,
		Consumer:     cfg.NATSConsumer,
		Inbox:        cfg.NotifyInbox,
		ConnectRetry: 2 * time.Second,
	}, m, resolver)

	go func() {
		if err := worker.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Fatal().Err(err).Msg("notify worker exited")
		}
	}()

	app := fiber.New(fiber.Config{
		AppName:      "AAELink Notify Service v0.0.1-alpha",
		ErrorHandler: errorHandler,
	})

	app.Use(metrics.Middleware("notify"))

	app.Get("/health", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "notify",
			"version": "0.0.2-alpha",
		})
	})
	app.Get("/ready", func(c fiber.Ctx) error {
		checks := fiber.Map{}
		status := "ok"
		code := fiber.StatusOK
		if resolver == nil {
			status = "degraded"
			code = fiber.StatusServiceUnavailable
			checks["auth_database"] = fiber.Map{"status": "down", "mode": "fallback_inbox"}
		} else {
			checks["auth_database"] = fiber.Map{"status": "ok"}
		}
		return c.Status(code).JSON(fiber.Map{
			"status":  status,
			"service": "notify",
			"checks":  checks,
		})
	})
	app.Get("/metrics", metrics.Handler())

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info().Str("port", cfg.HTTPPort).Msg("notify service starting")
		if err := app.Listen(":" + cfg.HTTPPort); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	<-quit
	log.Info().Msg("shutting down notify service")
	cancel()
	if err := app.Shutdown(); err != nil {
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
