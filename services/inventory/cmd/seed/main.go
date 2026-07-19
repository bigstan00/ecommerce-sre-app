// Command seed populates the Inventory service's stock table from the
// Catalog service's product list, giving every product 100 units of
// available stock.
//
// The Catalog service (CATALOG_SERVICE_URL) must already be running and
// already seeded with products before this is run — see the README for run
// order.
//
// Run with: go run ./cmd/seed
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"inventory/internal/config"
	"inventory/internal/db"
	"inventory/internal/inventory"
)

const (
	seedAvailable = 100
	pageLimit     = 50
)

// catalogProduct only decodes the fields the seed script needs from
// Catalog's GET /products item shape.
type catalogProduct struct {
	ID string `json:"id"`
}

// catalogListResponse mirrors Catalog's GET /products response envelope:
// {items, total, page, limit}.
type catalogListResponse struct {
	Items []catalogProduct `json:"items"`
	Total int64            `json:"total"`
	Page  int64            `json:"page"`
	Limit int64            `json:"limit"`
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	dbPool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to postgres: %v", err)
	}
	defer dbPool.Close()

	if err := db.Migrate(ctx, dbPool); err != nil {
		log.Fatalf("failed to run migrations: %v", err)
	}

	repo := inventory.NewRepository(dbPool)
	httpClient := &http.Client{Timeout: 10 * time.Second}

	seeded := 0
	page := int64(1)

	for {
		products, total, err := fetchProductsPage(ctx, httpClient, cfg.CatalogServiceURL, page, pageLimit)
		if err != nil {
			log.Fatalf("failed to fetch products from catalog service: %v", err)
		}

		if len(products) == 0 {
			break
		}

		for _, p := range products {
			if p.ID == "" {
				continue
			}
			if err := repo.UpsertStock(ctx, p.ID, seedAvailable); err != nil {
				log.Fatalf("failed to upsert stock for product %s: %v", p.ID, err)
			}
			seeded++
		}

		log.Printf("seeded page %d (%d products so far, %d total reported by catalog)", page, seeded, total)

		if int64(seeded) >= total || int64(len(products)) < pageLimit {
			break
		}
		page++
	}

	log.Printf("done: seeded stock for %d products, available=%d each", seeded, seedAvailable)
}

func fetchProductsPage(ctx context.Context, client *http.Client, catalogURL string, page, limit int64) ([]catalogProduct, int64, error) {
	url := fmt.Sprintf("%s/products?page=%d&limit=%d", catalogURL, page, limit)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("GET %s: unexpected status %d", url, resp.StatusCode)
	}

	var body catalogListResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, 0, fmt.Errorf("decode response from %s: %w", url, err)
	}

	return body.Items, body.Total, nil
}
