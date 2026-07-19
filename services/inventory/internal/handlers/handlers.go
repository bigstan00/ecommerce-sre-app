// Package handlers implements the Inventory service HTTP handlers.
package handlers

import (
	"encoding/json"
	"net/http"

	"go.uber.org/zap"

	"inventory/internal/db"
	"inventory/internal/inventory"
)

// Handler bundles the dependencies shared by all Inventory HTTP handlers.
type Handler struct {
	DB         *db.Pool
	Repo       *inventory.Repository
	Logger     *zap.Logger
	AdminToken string
	KafkaCheck func() error
}

// New constructs a Handler with the given dependencies.
func New(dbPool *db.Pool, repo *inventory.Repository, logger *zap.Logger, adminToken string, kafkaCheck func() error) *Handler {
	return &Handler{DB: dbPool, Repo: repo, Logger: logger, AdminToken: adminToken, KafkaCheck: kafkaCheck}
}

func errField(err error) zap.Field {
	return zap.Error(err)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
