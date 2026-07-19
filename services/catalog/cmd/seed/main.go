// Command seed inserts a set of sample products into the Catalog database.
// Run with: go run ./cmd/seed
package main

import (
	"context"
	"log"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"

	"catalog/internal/config"
	"catalog/internal/db"
	"catalog/internal/models"
)

func sampleProducts() []models.Product {
	now := time.Now().UTC()

	raw := []struct {
		name        string
		description string
		price       float64
		category    string
		imageURL    string
		stock       int
	}{
		// electronics
		{"Wireless Noise-Cancelling Headphones", "Over-ear Bluetooth headphones with active noise cancellation and 30-hour battery life.", 149.99, "electronics", "https://picsum.photos/seed/headphones/400", 42},
		{"27-inch 4K Monitor", "IPS panel 4K UHD monitor with HDR support and USB-C connectivity.", 329.00, "electronics", "https://picsum.photos/seed/monitor/400", 15},
		{"Mechanical Keyboard", "Hot-swappable mechanical keyboard with RGB backlighting and tactile switches.", 89.99, "electronics", "https://picsum.photos/seed/keyboard/400", 60},
		{"Portable Bluetooth Speaker", "Waterproof portable speaker with 12-hour playtime and deep bass.", 59.99, "electronics", "https://picsum.photos/seed/speaker/400", 78},
		{"Smartwatch Series 5", "Fitness tracking smartwatch with heart-rate monitor and GPS.", 199.99, "electronics", "https://picsum.photos/seed/smartwatch/400", 33},

		// apparel
		{"Men's Classic Fit T-Shirt", "100% cotton crew-neck t-shirt, machine washable.", 19.99, "apparel", "https://picsum.photos/seed/tshirt/400", 120},
		{"Women's Running Jacket", "Lightweight windproof running jacket with reflective trim.", 64.99, "apparel", "https://picsum.photos/seed/jacket/400", 45},
		{"Denim Jeans - Slim Fit", "Stretch denim jeans with a modern slim fit cut.", 49.99, "apparel", "https://picsum.photos/seed/jeans/400", 90},
		{"Wool Blend Beanie", "Warm knit beanie made from a soft wool blend.", 14.99, "apparel", "https://picsum.photos/seed/beanie/400", 150},

		// home goods
		{"Stainless Steel French Press", "34oz French press with double-wall insulated stainless steel body.", 34.99, "home goods", "https://picsum.photos/seed/frenchpress/400", 50},
		{"Ceramic Dinnerware Set (16-piece)", "Service for four, dishwasher and microwave safe.", 79.99, "home goods", "https://picsum.photos/seed/dinnerware/400", 25},
		{"Memory Foam Pillow", "Contoured memory foam pillow for neck and shoulder support.", 29.99, "home goods", "https://picsum.photos/seed/pillow/400", 70},
		{"Aromatherapy Essential Oil Diffuser", "Ultrasonic diffuser with 7-color LED and auto shut-off.", 24.99, "home goods", "https://picsum.photos/seed/diffuser/400", 55},

		// books
		{"The Pragmatic Programmer", "A guide to becoming a more effective and adaptable software engineer.", 39.99, "books", "https://picsum.photos/seed/pragprog/400", 40},
		{"Designing Data-Intensive Applications", "The big ideas behind reliable, scalable, and maintainable systems.", 44.99, "books", "https://picsum.photos/seed/ddia/400", 28},
	}

	products := make([]models.Product, 0, len(raw))
	for _, p := range raw {
		products = append(products, models.Product{
			ID:          primitive.NewObjectID(),
			Name:        p.name,
			Description: p.description,
			Price:       p.price,
			Category:    p.category,
			ImageURL:    p.imageURL,
			Stock:       p.stock,
			CreatedAt:   now,
		})
	}
	return products
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	dbClient, err := db.Connect(ctx, cfg.MongoURI, cfg.MongoDBName)
	if err != nil {
		log.Fatalf("failed to connect to mongodb: %v", err)
	}
	defer func() {
		disconnectCtx, disconnectCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer disconnectCancel()
		_ = dbClient.Disconnect(disconnectCtx)
	}()

	products := sampleProducts()
	docs := make([]interface{}, 0, len(products))
	for _, p := range products {
		docs = append(docs, p)
	}

	result, err := dbClient.Products().InsertMany(ctx, docs)
	if err != nil {
		log.Fatalf("failed to insert seed products: %v", err)
	}

	log.Printf("seeded %d products into database %q", len(result.InsertedIDs), cfg.MongoDBName)
}
