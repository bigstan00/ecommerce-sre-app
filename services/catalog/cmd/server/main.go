// Command server runs the Catalog HTTP API.
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

	"catalog/internal/config"
	"catalog/internal/db"
	"catalog/internal/handlers"
	"catalog/internal/logging"
	"catalog/internal/tracing"
)

func main() {
	logger, err := logging.New("catalog")
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

	shutdownTracing, err := tracing.Init(ctx, logger)
	if err != nil {
		// Tracing is additive instrumentation, not a hard dependency --
		// don't crash the service if the SDK fails to initialize (e.g. a
		// malformed OTEL_EXPORTER_OTLP_ENDPOINT), just run untraced.
		logger.Warn("failed to initialize otel tracing, continuing without it", zap.Error(err))
		shutdownTracing = func(context.Context) error { return nil }
	}
	defer func() {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		if err := shutdownTracing(shutdownCtx); err != nil {
			logger.Error("failed to shut down otel tracing", zap.Error(err))
		}
	}()

	dbClient, err := db.Connect(ctx, cfg.MongoURI, cfg.MongoDBName)
	if err != nil {
		logger.Fatal("failed to connect to mongodb", zap.Error(err))
	}
	defer func() {
		disconnectCtx, disconnectCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer disconnectCancel()
		if err := dbClient.Disconnect(disconnectCtx); err != nil {
			logger.Error("failed to disconnect from mongodb", zap.Error(err))
		}
	}()

	logger.Info("connected to mongodb", zap.String("database", cfg.MongoDBName))

	h := handlers.New(dbClient, logger, cfg.AdminToken)
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
		logger.Info("catalog service listening", zap.String("port", cfg.Port))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("server failed", zap.Error(err))
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	logger.Info("shutting down catalog service")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", zap.Error(err))
	}
}
