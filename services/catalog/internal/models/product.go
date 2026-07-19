package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Product represents a catalog item stored in the "products" collection.
type Product struct {
	ID          primitive.ObjectID `json:"id" bson:"_id,omitempty"`
	Name        string             `json:"name" bson:"name"`
	Description string             `json:"description" bson:"description"`
	Price       float64            `json:"price" bson:"price"`
	Category    string             `json:"category" bson:"category"`
	ImageURL    string             `json:"imageUrl" bson:"imageUrl"`
	Stock       int                `json:"stock" bson:"stock"`
	CreatedAt   time.Time          `json:"createdAt" bson:"createdAt"`
}

// ProductInput is the payload accepted by POST /products. ID and CreatedAt
// are server-assigned, so they are intentionally excluded here.
type ProductInput struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Price       float64 `json:"price"`
	Category    string  `json:"category"`
	ImageURL    string  `json:"imageUrl"`
	Stock       int     `json:"stock"`
}

// Validate performs basic sanity checks on a product input payload.
func (p ProductInput) Validate() string {
	if p.Name == "" {
		return "name is required"
	}
	if p.Category == "" {
		return "category is required"
	}
	if p.Price < 0 {
		return "price must be >= 0"
	}
	if p.Stock < 0 {
		return "stock must be >= 0"
	}
	return ""
}

// ProductListResponse is the response envelope for GET /products.
type ProductListResponse struct {
	Items []Product `json:"items"`
	Total int64     `json:"total"`
	Page  int64     `json:"page"`
	Limit int64     `json:"limit"`
}

// CategoriesResponse is the response envelope for GET /categories.
type CategoriesResponse struct {
	Categories []string `json:"categories"`
}
