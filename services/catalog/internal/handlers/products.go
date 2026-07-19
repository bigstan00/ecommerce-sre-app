package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"

	"catalog/internal/models"
)

const (
	defaultPage  = 1
	defaultLimit = 20
	maxLimit     = 100
)

// ListProducts handles GET /products?category=&page=&limit=.
func (h *Handler) ListProducts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()

	page := parsePositiveInt(q.Get("page"), defaultPage)
	limit := parsePositiveInt(q.Get("limit"), defaultLimit)
	if limit > maxLimit {
		limit = maxLimit
	}

	filter := bson.M{}
	if category := q.Get("category"); category != "" {
		filter["category"] = category
	}

	total, err := h.DB.Products().CountDocuments(ctx, filter)
	if err != nil {
		h.Logger.Error("failed to count products", errField(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	findOpts := options.Find().
		SetSkip((page - 1) * limit).
		SetLimit(limit).
		SetSort(bson.D{{Key: "createdAt", Value: -1}})

	cursor, err := h.DB.Products().Find(ctx, filter, findOpts)
	if err != nil {
		h.Logger.Error("failed to list products", errField(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	defer cursor.Close(ctx)

	items := make([]models.Product, 0)
	if err := cursor.All(ctx, &items); err != nil {
		h.Logger.Error("failed to decode products", errField(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	writeJSON(w, http.StatusOK, models.ProductListResponse{
		Items: items,
		Total: total,
		Page:  page,
		Limit: limit,
	})
}

// GetProduct handles GET /products/:id.
func (h *Handler) GetProduct(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	idParam := chi.URLParam(r, "id")

	objID, err := primitive.ObjectIDFromHex(idParam)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "product not found"})
		return
	}

	var product models.Product
	err = h.DB.Products().FindOne(ctx, bson.M{"_id": objID}).Decode(&product)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "product not found"})
			return
		}
		h.Logger.Error("failed to get product", errField(err), zap.String("id", idParam))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"product": product})
}

// CreateProduct handles POST /products, gated by the X-Admin-Token header.
func (h *Handler) CreateProduct(w http.ResponseWriter, r *http.Request) {
	token := r.Header.Get("X-Admin-Token")
	if token == "" || token != h.AdminToken {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}

	var input models.ProductInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if msg := input.Validate(); msg != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
		return
	}

	product := models.Product{
		ID:          primitive.NewObjectID(),
		Name:        input.Name,
		Description: input.Description,
		Price:       input.Price,
		Category:    input.Category,
		ImageURL:    input.ImageURL,
		Stock:       input.Stock,
		CreatedAt:   time.Now().UTC(),
	}

	_, err := h.DB.Products().InsertOne(r.Context(), product)
	if err != nil {
		h.Logger.Error("failed to create product", errField(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	h.Logger.Info("product created", zap.String("id", product.ID.Hex()), zap.String("name", product.Name))
	writeJSON(w, http.StatusCreated, map[string]string{"id": product.ID.Hex()})
}

func parsePositiveInt(raw string, fallback int64) int64 {
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v < 1 {
		return fallback
	}
	return v
}
