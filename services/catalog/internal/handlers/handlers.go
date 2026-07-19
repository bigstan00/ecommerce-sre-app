// Package handlers implements the Catalog service HTTP handlers.
package handlers

import (
	"go.uber.org/zap"

	"catalog/internal/db"
)

// Handler bundles the dependencies shared by all Catalog HTTP handlers.
type Handler struct {
	DB         *db.Client
	Logger     *zap.Logger
	AdminToken string
}

// New constructs a Handler with the given dependencies.
func New(dbClient *db.Client, logger *zap.Logger, adminToken string) *Handler {
	return &Handler{DB: dbClient, Logger: logger, AdminToken: adminToken}
}

func errField(err error) zap.Field {
	return zap.Error(err)
}
