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

	"github.com/Dry1ceD7/AAELink/services/ticket/internal/config"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/db"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/events"
	tickethttp "github.com/Dry1ceD7/AAELink/services/ticket/internal/http"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/metrics"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/security"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/service"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/sse"
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

	pub, closeNats, err := events.NewPublisher(cfg.NATSURL)
	if err != nil {
		log.Warn().Err(err).Msg("nats unavailable; events disabled")
	}
	if closeNats != nil {
		defer closeNats()
	}

	hub := sse.NewHub()
	verifier := security.NewVerifier(cfg.JWTSecret)
	tickets := repository.NewTicketRepository(pool)
	comments := repository.NewCommentRepository(pool)
	svc := service.NewTicketService(tickets, comments, pub, hub)
	handlers := tickethttp.NewHandlers(svc, verifier, hub)

	app := fiber.New(fiber.Config{
		AppName:      "AAELink Ticket Service v0.1.0",
		ErrorHandler: errorHandler,
	})

	app.Use(metrics.Middleware("ticket"))

	app.Get("/health", func(c fiber.Ctx) error {
		if err := pool.Ping(c.Context()); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"status":  "unhealthy",
				"service": "ticket",
				"error":   err.Error(),
			})
		}
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "ticket",
			"version": "0.1.0",
		})
	})

	app.Get("/metrics", metrics.Handler())

	handlers.Register(app)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info().Str("port", cfg.HTTPPort).Msg("ticket service starting")
		if err := app.Listen(":" + cfg.HTTPPort); err != nil {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	<-quit
	log.Info().Msg("shutting down ticket service")
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
