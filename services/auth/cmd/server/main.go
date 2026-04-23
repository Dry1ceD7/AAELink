package main

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/gofiber/fiber/v3"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	// Configure structured JSON logging
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	if os.Getenv("APP_ENV") == "development" {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}

	port := os.Getenv("HTTP_PORT")
	if port == "" {
		port = "8001"
	}

	app := fiber.New(fiber.Config{
		AppName:      "AAELink Auth Service v0.1.0",
		ErrorHandler: errorHandler,
	})

	// Health check — required by Docker and Traefik
	app.Get("/health", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "auth",
			"version": "0.1.0",
		})
	})

	// Metrics endpoint placeholder (Prometheus)
	app.Get("/metrics", func(c fiber.Ctx) error {
		return c.SendString("# AAELink auth metrics\n")
	})

	// TODO: Register routes (Layer 4)
	// auth.RegisterRoutes(app, deps)

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Info().Str("port", port).Msg("auth service starting")
		if err := app.Listen(":" + port); err != nil {
			log.Fatal().Err(err).Msg("server error")
		}
	}()

	<-quit
	log.Info().Msg("shutting down auth service")
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
