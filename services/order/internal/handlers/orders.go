package handlers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	"order/internal/db"
	"order/internal/kafka"
)

// userIDHeader is set by the API gateway once it has verified the caller's
// JWT; downstream services (this one included) trust it rather than
// re-verifying the token themselves. See the Trust boundary note in
// shared/CONTRACTS.md and this service's README.
const userIDHeader = "X-User-Id"

// CreateOrder handles POST /orders. It reads the caller's cart, creates the
// order (status=pending), publishes order.created, clears the cart, and
// returns immediately — it does not wait for the checkout saga to finish.
func (h *Handler) CreateOrder(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get(userIDHeader)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "X-User-Id header is required")
		return
	}

	ctx := r.Context()

	cart, err := h.Cart.GetCart(ctx, userID)
	if err != nil {
		h.Logger.Error("failed to fetch cart", zap.String("userId", userID), zap.Error(err))
		writeError(w, http.StatusBadGateway, "failed to reach cart service")
		return
	}

	if len(cart.Items) == 0 {
		writeError(w, http.StatusBadRequest, "cart is empty")
		return
	}

	items := make([]db.NewOrderItem, 0, len(cart.Items))
	for _, it := range cart.Items {
		items = append(items, db.NewOrderItem{
			ProductID:     it.ProductID,
			Quantity:      it.Quantity,
			PriceSnapshot: it.PriceSnapshot,
		})
	}

	order, err := h.DB.CreateOrder(ctx, userID, cart.Total, items)
	if err != nil {
		h.Logger.Error("failed to create order", zap.String("userId", userID), zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to create order")
		return
	}

	eventItems := make([]kafka.OrderCreatedItem, 0, len(order.Items))
	for _, it := range order.Items {
		eventItems = append(eventItems, kafka.OrderCreatedItem{
			ProductID:     it.ProductID,
			Quantity:      it.Quantity,
			PriceSnapshot: it.PriceSnapshot,
		})
	}

	err = h.Producer.Publish(ctx, kafka.TopicOrderCreated, kafka.EventOrderCreated, order.ID, kafka.OrderCreatedData{
		UserID:      userID,
		Items:       eventItems,
		TotalAmount: order.TotalAmount,
	})
	if err != nil {
		// The order row is already committed; the saga just won't start
		// until this is retried. Log loudly but still return 201 — the
		// order legitimately exists in `pending` state.
		h.Logger.Error("failed to publish order.created", zap.String("orderId", order.ID), zap.Error(err))
	}

	if err := h.Cart.DeleteCart(ctx, userID); err != nil {
		// Best-effort: the order and its event are already durable, so a
		// failure here just leaves stale items in the cart for the user
		// to see next time. Not fatal to this request.
		h.Logger.Warn("failed to clear cart after order creation",
			zap.String("userId", userID), zap.String("orderId", order.ID), zap.Error(err))
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"orderId": order.ID,
		"status":  order.Status,
	})
}

// GetOrder handles GET /orders/:id.
func (h *Handler) GetOrder(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get(userIDHeader)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "X-User-Id header is required")
		return
	}

	orderID := chi.URLParam(r, "id")

	order, err := h.DB.GetOrder(r.Context(), orderID, userID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "order not found")
			return
		}
		h.Logger.Error("failed to fetch order", zap.String("orderId", orderID), zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to fetch order")
		return
	}

	writeJSON(w, http.StatusOK, order.ToView())
}

// ListOrders handles GET /orders.
func (h *Handler) ListOrders(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get(userIDHeader)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "X-User-Id header is required")
		return
	}

	orders, err := h.DB.ListOrders(r.Context(), userID)
	if err != nil {
		h.Logger.Error("failed to list orders", zap.String("userId", userID), zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to list orders")
		return
	}

	views := make([]any, 0, len(orders))
	for _, o := range orders {
		views = append(views, o.ToView())
	}

	writeJSON(w, http.StatusOK, map[string]any{"orders": views})
}
