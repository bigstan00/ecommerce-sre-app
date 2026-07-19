package handlers

import (
	"encoding/json"
	"net/http"
)

// Healthz is a liveness probe. It never checks dependencies — it only
// confirms the process is up and able to handle HTTP requests.
func (h *Handler) Healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Readyz is a readiness probe. It actually pings MongoDB and reports
// 503 with a reason if the dependency is unreachable.
func (h *Handler) Readyz(w http.ResponseWriter, r *http.Request) {
	if err := h.DB.Ping(r.Context()); err != nil {
		h.Logger.Warn("readiness check failed", errField(err))
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"status": "not-ready",
			"reason": err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
