// Command server runs the Inventory HTTP API and its background Kafka
// consumer.
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

	"inventory/internal/config"
	"inventory/internal/db"
	"inventory/internal/eventbus"
	"inventory/internal/handlers"
	"inventory/internal/inventory"
	"inventory/internal/logging"
	"inventory/internal/tracing"
)

func main() {
	logger, err := logging.New("inventory")
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

	// Initialize OTel tracing as early as possible (Phase 4 — see
	// shared/CONTRACTS.md). Tracing is additive instrumentation, not a
	// startup dependency: if the exporter can't reach the OTLP endpoint,
	// spans are just dropped/logged, never fatal.
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

	dbPool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("failed to connect to postgres", zap.Error(err))
	}
	defer dbPool.Close()

	logger.Info("connected to postgres")

	if err := db.Migrate(ctx, dbPool); err != nil {
		logger.Fatal("failed to run migrations", zap.Error(err))
	}
	logger.Info("migrations applied")

	// This service produces inventory.reserved and inventory.failed, so it
	// creates those topics on startup (idempotent, with retry/backoff if
	// the broker isn't up yet).
	if err := eventbus.EnsureTopics(ctx, cfg.KafkaBrokers, []string{
		eventbus.TopicInventoryReserved,
		eventbus.TopicInventoryFailed,
	}, logger); err != nil {
		logger.Fatal("failed to ensure kafka topics", zap.Error(err))
	}

	repo := inventory.NewRepository(dbPool)
	producer := eventbus.NewProducer(cfg.KafkaBrokers, logger)
	defer func() {
		if err := producer.Close(); err != nil {
			logger.Error("failed to close kafka producer", zap.Error(err))
		}
	}()

	svc := inventory.NewService(repo, producer, logger)

	consumer := eventbus.NewConsumer(cfg.KafkaBrokers, "inventory-service", []string{
		eventbus.TopicOrderCreated,
		eventbus.TopicPaymentFailed,
	}, logger)
	consumer.On(eventbus.TopicOrderCreated, svc.HandleOrderCreated)
	consumer.On(eventbus.TopicPaymentFailed, svc.HandlePaymentFailed)
	defer func() {
		if err := consumer.Close(); err != nil {
			logger.Error("failed to close kafka consumer", zap.Error(err))
		}
	}()

	go func() {
		logger.Info("starting kafka consumer",
			zap.String("groupId", "inventory-service"),
			zap.Strings("topics", []string{eventbus.TopicOrderCreated, eventbus.TopicPaymentFailed}),
		)
		consumer.Run(ctx)
	}()

	kafkaCheck := func() error {
		return eventbus.Ping(ctx, cfg.KafkaBrokers)
	}

	h := handlers.New(dbPool, repo, logger, cfg.AdminToken, kafkaCheck)
	router := handlers.NewRouter(h, logger)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		logger.Info("inventory service listening", zap.String("port", cfg.Port))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	logger.Info("shutting down inventory service")

	cancel() // stop the kafka consumer loop

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", zap.Error(err))
	}
}
