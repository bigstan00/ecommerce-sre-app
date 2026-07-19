package handlers

import (
	"net/http"

	"go.mongodb.org/mongo-driver/bson"

	"catalog/internal/models"
)

// ListCategories handles GET /categories, returning the distinct set of
// product categories currently in the collection.
func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	raw, err := h.DB.Products().Distinct(r.Context(), "category", bson.M{})
	if err != nil {
		h.Logger.Error("failed to list categories", errField(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	categories := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok {
			categories = append(categories, s)
		}
	}

	writeJSON(w, http.StatusOK, models.CategoriesResponse{Categories: categories})
}
