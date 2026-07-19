// Package config loads Order service configuration exclusively from
// environment variables, per the repo-wide cross-cutting conventions.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Config holds all runtime configuration for the Order service.
type Config struct {
	Port           string
	DatabaseURL    string
	KafkaBrokers   []string
	CartServiceURL string
	AdminToken     string
}

// Load reads configuration from environment variables, applying safe
// defaults where documented in .env.example, and returns an error if a
// required variable is missing.
func Load() (Config, error) {
	cfg := Config{
		Port:           getEnv("PORT", "4004"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		KafkaBrokers:   splitAndTrim(getEnv("KAFKA_BROKERS", "localhost:9092")),
		CartServiceURL: os.Getenv("CART_SERVICE_URL"),
		AdminToken:     os.Getenv("ADMIN_TOKEN"),
	}

	if cfg.DatabaseURL == "" {
		return cfg, fmt.Errorf("DATABASE_URL environment variable is required")
	}
	if cfg.CartServiceURL == "" {
		return cfg, fmt.Errorf("CART_SERVICE_URL environment variable is required")
	}
	if len(cfg.KafkaBrokers) == 0 {
		return cfg, fmt.Errorf("KAFKA_BROKERS environment variable is required")
	}
	if cfg.AdminToken == "" {
		return cfg, fmt.Errorf("ADMIN_TOKEN environment variable is required")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func splitAndTrim(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
