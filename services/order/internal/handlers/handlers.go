// Package handlers implements the Order service's HTTP API: POST /orders,
// GET /orders/:id, GET /orders, GET /admin/orders, plus health/readiness
// endpoints.
package handlers

import (
	"encoding/json"
	"net/http"

	"go.uber.org/zap"

	"order/internal/cartclient"
	"order/internal/db"
	"order/internal/kafka"
)

// Handler holds the dependencies shared by all HTTP handlers.
type Handler struct {
	DB           *db.DB
	Cart         *cartclient.Client
	Producer     *kafka.Producer
	KafkaBrokers []string
	AdminToken   string
	Logger       *zap.Logger
}

// New builds a Handler.
func New(database *db.DB, cart *cartclient.Client, producer *kafka.Producer, kafkaBrokers []string, adminToken string, logger *zap.Logger) *Handler {
	return &Handler{DB: database, Cart: cart, Producer: producer, KafkaBrokers: kafkaBrokers, AdminToken: adminToken, Logger: logger}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
