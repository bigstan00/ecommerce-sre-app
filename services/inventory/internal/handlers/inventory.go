package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	"inventory/internal/inventory"
	"inventory/internal/models"
)

const (
	defaultPage  = 1
	defaultLimit = 20
	maxLimit     = 100
)

// GetStock handles GET /inventory/:productId. Read-only, for
// debugging/admin use — not called by any other service.
func (h *Handler) GetStock(w http.ResponseWriter, r *http.Request) {
	productID := chi.URLParam(r, "productId")

	stock, err := h.Repo.GetStock(r.Context(), productID)
	if err != nil {
		if errors.Is(err, inventory.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "product not found"})
			return
		}
		h.Logger.Error("failed to get stock", errField(err), zap.String("productId", productID))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"productId": stock.ProductID,
		"available": stock.Available,
	})
}

// ListStock handles GET /inventory?page=&limit=, gated by the
// X-Admin-Token header. For the admin dashboard (Phase 5) — not called by
// any other service.
func (h *Handler) ListStock(w http.ResponseWriter, r *http.Request) {
	token := r.Header.Get("X-Admin-Token")
	if token == "" || token != h.AdminToken {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}

	q := r.URL.Query()
	page := parsePositiveInt(q.Get("page"), defaultPage)
	limit := parsePositiveInt(q.Get("limit"), defaultLimit)
	if limit > maxLimit {
		limit = maxLimit
	}

	items, total, err := h.Repo.ListStock(r.Context(), limit, (page-1)*limit)
	if err != nil {
		h.Logger.Error("failed to list stock", errField(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	writeJSON(w, http.StatusOK, models.StockListResponse{
		Items: items,
		Total: total,
		Page:  page,
		Limit: limit,
	})
}

func parsePositiveInt(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		return fallback
	}
	return v
}

// UpsertStock handles POST /inventory, gated by the X-Admin-Token header.
func (h *Handler) UpsertStock(w http.ResponseWriter, r *http.Request) {
	token := r.Header.Get("X-Admin-Token")
	if token == "" || token != h.AdminToken {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}

	var req models.UpsertStockRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.ProductID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "productId is required"})
		return
	}
	if req.Available < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "available must be >= 0"})
		return
	}

	if err := h.Repo.UpsertStock(r.Context(), req.ProductID, req.Available); err != nil {
		h.Logger.Error("failed to upsert stock", errField(err), zap.String("productId", req.ProductID))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	h.Logger.Info("stock upserted", zap.String("productId", req.ProductID), zap.Int("available", req.Available))
	writeJSON(w, http.StatusOK, map[string]any{
		"productId": req.ProductID,
		"available": req.Available,
	})
}
