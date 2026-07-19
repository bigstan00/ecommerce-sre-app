// Package config loads Catalog service configuration exclusively from
// environment variables, per the repo-wide cross-cutting conventions.
package config

import (
	"fmt"
	"os"
)

// Config holds all runtime configuration for the Catalog service.
type Config struct {
	Port        string
	MongoURI    string
	MongoDBName string
	AdminToken  string
}

// Load reads configuration from environment variables, applying safe
// defaults where documented in .env.example, and returns an error if a
// required variable is missing.
func Load() (Config, error) {
	cfg := Config{
		Port:        getEnv("PORT", "4002"),
		MongoURI:    getEnv("MONGO_URI", "mongodb://localhost:27017"),
		MongoDBName: getEnv("MONGO_DB_NAME", "catalog"),
		AdminToken:  os.Getenv("ADMIN_TOKEN"),
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
