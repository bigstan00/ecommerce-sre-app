// Command server runs the Order HTTP API and its background Kafka
// consumer (the checkout saga's state machine).
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.uber.org/zap"

	"order/internal/cartclient"
	"order/internal/config"
	"order/internal/db"
	"order/internal/handlers"
	"order/internal/kafka"
	"order/internal/logging"
	"order/internal/tracing"
)

func main() {
	logger, err := logging.New("order")
	if err != nil {
		panic(err)
	}
	defer logger.Sync() //nolint:errcheck

	cfg, err := config.Load()
	if err != nil {
		logger.Fatal("failed to load config", zap.Error(err))
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Tracing is additive instrumentation, not a startup dependency: per
	// shared/CONTRACTS.md, an unreachable OTLP collector must never block
	// or crash the service, only cause spans to be dropped/logged as a
	// warning (handled inside tracing.Init via otel.SetErrorHandler).
	shutdownTracing, err := tracing.Init(ctx, logger)
	if err != nil {
		logger.Fatal("failed to initialize otel tracing", zap.Error(err))
	}
	defer func() {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		if err := shutdownTracing(shutdownCtx); err != nil {
			logger.Warn("otel tracer provider shutdown failed", zap.Error(err))
		}
	}()

	dbClient, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("failed to connect to postgres", zap.Error(err))
	}
	defer dbClient.Close()

	logger.Info("connected to postgres")

	if err := dbClient.Migrate(ctx); err != nil {
		logger.Fatal("failed to apply schema migration", zap.Error(err))
	}
	logger.Info("schema migration applied")

	// The Order service is the producer for these three topics, so it owns
	// creating them (idempotently, with retry/backoff) per CONTRACTS.md.
	if err := kafka.EnsureTopics(ctx, cfg.KafkaBrokers, []string{
		kafka.TopicOrderCreated,
		kafka.TopicOrderConfirmed,
		kafka.TopicOrderCancelled,
	}, logger); err != nil {
		logger.Fatal("failed to ensure kafka topics", zap.Error(err))
	}

	producer := kafka.NewProducer(cfg.KafkaBrokers, logger)
	defer producer.Close() //nolint:errcheck

	cartClient := cartclient.New(cfg.CartServiceURL)

	h := handlers.New(dbClient, cartClient, producer, cfg.KafkaBrokers, cfg.AdminToken, logger)
	router := handlers.NewRouter(h, logger)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// The background Kafka consumer runs on its own goroutine, independent
	// of the HTTP server, started at boot per CONTRACTS.md.
	consumer := kafka.NewConsumer(cfg.KafkaBrokers, dbClient, producer, logger)
	go consumer.Run(ctx)

	go func() {
		logger.Info("order service listening", zap.String("port", cfg.Port))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	logger.Info("shutting down order service")

	// Stop the Kafka consumer goroutines by cancelling the shared context.
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", zap.Error(err))
	}
}
