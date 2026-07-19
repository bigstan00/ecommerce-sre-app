package handlers

import (
	"net/http"

	"go.uber.org/zap"

	"order/internal/kafka"
)

// Healthz is a liveness probe. It never checks dependencies — it only
// confirms the process is up and able to handle HTTP requests.
func (h *Handler) Healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Readyz is a readiness probe. It checks both PostgreSQL and Kafka broker
// connectivity, per shared/CONTRACTS.md.
func (h *Handler) Readyz(w http.ResponseWriter, r *http.Request) {
	if err := h.DB.Ping(r.Context()); err != nil {
		h.Logger.Warn("readiness check failed: postgres", zap.Error(err))
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"status": "not-ready",
			"reason": "postgres: " + err.Error(),
		})
		return
	}

	if err := kafka.Ping(r.Context(), h.KafkaBrokers); err != nil {
		h.Logger.Warn("readiness check failed: kafka", zap.Error(err))
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"status": "not-ready",
			"reason": "kafka: " + err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}
