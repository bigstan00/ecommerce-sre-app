package handlers

import (
	"net/http"
)

// Healthz is a liveness probe. It never checks dependencies — it only
// confirms the process is up and able to handle HTTP requests.
func (h *Handler) Healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Readyz is a readiness probe. It actually checks PostgreSQL and Kafka
// connectivity, reporting 503 with a reason if either is unreachable.
func (h *Handler) Readyz(w http.ResponseWriter, r *http.Request) {
	if err := h.DB.Ping(r.Context()); err != nil {
		h.Logger.Warn("readiness check failed: postgres", errField(err))
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"status": "not-ready",
			"reason": "postgres: " + err.Error(),
		})
		return
	}

	if h.KafkaCheck != nil {
		if err := h.KafkaCheck(); err != nil {
			h.Logger.Warn("readiness check failed: kafka", errField(err))
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"status": "not-ready",
				"reason": "kafka: " + err.Error(),
			})
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}
