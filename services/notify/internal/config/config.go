package config

import (
	"os"
	"strconv"
)

type Config struct {
	Env      string
	HTTPPort string

	NATSUrl       string
	NATSStream    string
	NATSSubject   string
	NATSConsumer  string

	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	SMTPFrom     string
	SMTPStartTLS bool

	NotifyInbox string
}

func Load() *Config {
	port, _ := strconv.Atoi(getenv("SMTP_PORT", "1025"))
	startTLS, _ := strconv.ParseBool(getenv("SMTP_STARTTLS", "false"))

	return &Config{
		Env:          getenv("APP_ENV", "development"),
		HTTPPort:     getenv("HTTP_PORT", "8003"),
		NATSUrl:      getenv("NATS_URL", "nats://nats:4222"),
		NATSStream:   getenv("NATS_STREAM", "TICKETS"),
		NATSSubject:  getenv("NATS_SUBJECT", "tickets.>"),
		NATSConsumer: getenv("NATS_CONSUMER", "notify-worker"),
		SMTPHost:     getenv("SMTP_HOST", "mailhog"),
		SMTPPort:     port,
		SMTPUser:     os.Getenv("SMTP_USER"),
		SMTPPassword: os.Getenv("SMTP_PASSWORD"),
		SMTPFrom:     getenv("SMTP_FROM", "AAELink <noreply@aae.local>"),
		SMTPStartTLS: startTLS,
		NotifyInbox:  getenv("NOTIFY_INBOX", "it@aae.local"),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
