package handlers

import (
	"net/http"
	"strconv"

	"go.uber.org/zap"
)

// adminTokenHeader is the static-token admin gate used by the Phase 5 admin
// dashboard — not full auth, just enough to keep casual callers out. See
// shared/CONTRACTS.md's "Phase 5: admin dashboard" section.
const adminTokenHeader = "X-Admin-Token"

const (
	defaultAdminPage  = 1
	defaultAdminLimit = 20
	maxAdminLimit     = 100
)

// ListOrdersAdmin handles GET /admin/orders?page=&limit=&status=, gated by
// the X-Admin-Token header (must equal the ADMIN_TOKEN env var), else 403.
// Unlike GET /orders, this returns orders across ALL users, not just the
// caller's — it's the admin dashboard's order list.
func (h *Handler) ListOrdersAdmin(w http.ResponseWriter, r *http.Request) {
	token := r.Header.Get(adminTokenHeader)
	if token == "" || token != h.AdminToken {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	q := r.URL.Query()
	page := parsePositiveInt(q.Get("page"), defaultAdminPage)
	limit := parsePositiveInt(q.Get("limit"), defaultAdminLimit)
	if limit > maxAdminLimit {
		limit = maxAdminLimit
	}
	status := q.Get("status")

	orders, total, err := h.DB.ListOrdersAdmin(r.Context(), status, page, limit)
	if err != nil {
		h.Logger.Error("failed to list admin orders", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to list orders")
		return
	}

	views := make([]any, 0, len(orders))
	for _, o := range orders {
		views = append(views, o.ToAdminView())
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"orders": views,
		"total":  total,
		"page":   page,
		"limit":  limit,
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
