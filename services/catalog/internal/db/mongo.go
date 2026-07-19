// Package db manages the MongoDB client lifecycle for the Catalog service.
package db

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
	"go.opentelemetry.io/contrib/instrumentation/go.mongodb.org/mongo-driver/mongo/otelmongo"
)

// Client wraps a mongo.Client along with the target database handle used
// throughout the service.
type Client struct {
	Mongo    *mongo.Client
	Database *mongo.Database
}

// Connect establishes a connection to MongoDB using the given URI and
// database name. It performs an initial ping so callers fail fast on
// startup if MongoDB is unreachable.
func Connect(ctx context.Context, uri, dbName string) (*Client, error) {
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// otelmongo attaches a CommandMonitor that turns every MongoDB wire
	// protocol command (find, insert, count, distinct, ...) issued through
	// this client into a child span of whatever span is active on the
	// context passed to that command (e.g. the otelhttp server span for
	// the request that triggered it) -- no manual span-per-query code
	// needed. It's a maintained package pinned to exactly the
	// go.mongodb.org/mongo-driver version this service already uses (see
	// go.mod), so it was used in place of hand-written instrumentation.
	client, err := mongo.Connect(connectCtx, options.Client().ApplyURI(uri).SetMonitor(otelmongo.NewMonitor()))
	if err != nil {
		return nil, err
	}

	pingCtx, cancelPing := context.WithTimeout(ctx, 5*time.Second)
	defer cancelPing()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		return nil, err
	}

	return &Client{
		Mongo:    client,
		Database: client.Database(dbName),
	}, nil
}

// Ping checks MongoDB connectivity; used by the /readyz handler.
func (c *Client) Ping(ctx context.Context) error {
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return c.Mongo.Ping(pingCtx, readpref.Primary())
}

// Disconnect closes the underlying MongoDB connection.
func (c *Client) Disconnect(ctx context.Context) error {
	return c.Mongo.Disconnect(ctx)
}

// Products returns the "products" collection handle.
func (c *Client) Products() *mongo.Collection {
	return c.Database.Collection("products")
}
