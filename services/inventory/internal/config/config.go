// Package config loads Inventory service configuration exclusively from
// environment variables, per the repo-wide cross-cutting conventions.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Config holds all runtime configuration for the Inventory service.
type Config struct {
	Port         string
	DatabaseURL  string
	KafkaBrokers []string
	AdminToken   string

	// CatalogServiceURL is only used by cmd/seed, not the HTTP server.
	CatalogServiceURL string
}

// Load reads configuration from environment variables, applying safe
// defaults where documented in .env.example, and returns an error if a
// required variable is missing.
func Load() (Config, error) {
	cfg := Config{
		Port:              getEnv("PORT", "4006"),
		DatabaseURL:       getEnv("DATABASE_URL", "postgres://inventory:inventory@localhost:5432/inventory"),
		KafkaBrokers:      splitCSV(getEnv("KAFKA_BROKERS", "localhost:9092")),
		AdminToken:        os.Getenv("ADMIN_TOKEN"),
		CatalogServiceURL: getEnv("CATALOG_SERVICE_URL", "http://localhost:4002"),
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

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
