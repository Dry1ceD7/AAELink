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

	worker := consumer.New(consumer.Options{
		URL:          cfg.NATSUrl,
		Stream:       cfg.NATSStream,
		Subject:      cfg.NATSSubject,
		Consumer:     cfg.NATSConsumer,
		Inbox:        cfg.NotifyInbox,
		ConnectRetry: 2 * time.Second,
	}, m)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		if err := worker.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Fatal().Err(err).Msg("notify worker exited")
		}
	}()

	app := fiber.New(fiber.Config{
		AppName:      "AAELink Notify Service v0.1.0",
		ErrorHandler: errorHandler,
	})

	app.Get("/health", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "notify",
			"version": "0.1.0",
		})
	})
	app.Get("/metrics", func(c fiber.Ctx) error {
		return c.SendString("# AAELink notify metrics\n")
	})

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
