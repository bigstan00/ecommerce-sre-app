// Package cartclient is a small HTTP client for the Cart service, used by
// the Order service to read and clear a user's cart during checkout.
package cartclient

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Item mirrors a single cart line item, per shared/CONTRACTS.md's Cart
// service GET /cart response shape.
type Item struct {
	ProductID     string  `json:"productId"`
	Quantity      int     `json:"quantity"`
	PriceSnapshot float64 `json:"priceSnapshot"`
}

// CartResponse mirrors the Cart service's GET /cart response shape.
type CartResponse struct {
	Items []Item  `json:"items"`
	Total float64 `json:"total"`
}

// Client calls the Cart service, forwarding the caller's X-User-Id header
// as required by shared/CONTRACTS.md (the Cart service trusts this header
// and does not re-verify the caller's JWT).
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// New builds a Client pointed at baseURL (CART_SERVICE_URL).
func New(baseURL string) *Client {
	return &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}
}

// GetCart calls GET /cart with X-User-Id: userID forwarded.
func (c *Client) GetCart(ctx context.Context, userID string) (CartResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/cart", nil)
	if err != nil {
		return CartResponse{}, err
	}
	req.Header.Set("X-User-Id", userID)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return CartResponse{}, fmt.Errorf("call cart service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return CartResponse{}, fmt.Errorf("cart service returned status %d", resp.StatusCode)
	}

	var cart CartResponse
	if err := json.NewDecoder(resp.Body).Decode(&cart); err != nil {
		return CartResponse{}, fmt.Errorf("decode cart response: %w", err)
	}
	return cart, nil
}

// DeleteCart calls DELETE /cart with X-User-Id: userID forwarded.
func (c *Client) DeleteCart(ctx context.Context, userID string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+"/cart", nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-User-Id", userID)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("call cart service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("cart service returned status %d", resp.StatusCode)
	}
	return nil
}
