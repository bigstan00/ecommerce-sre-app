// Package logging configures structured JSON logging (one JSON object per
// line, written to stdout) as required by the repo-wide conventions.
package logging

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// New builds a zap.Logger that writes structured JSON logs to stdout with a
// "service" field on every entry, and "timestamp"/"level"/"message" keys
// matching the cross-cutting logging convention.
func New(serviceName string) (*zap.Logger, error) {
	cfg := zap.Config{
		Level:            zap.NewAtomicLevelAt(zapcore.InfoLevel),
		Development:      false,
		Encoding:         "json",
		OutputPaths:      []string{"stdout"},
		ErrorOutputPaths: []string{"stderr"},
		EncoderConfig: zapcore.EncoderConfig{
			TimeKey:        "timestamp",
			LevelKey:       "level",
			NameKey:        "logger",
			MessageKey:     "message",
			CallerKey:      "caller",
			StacktraceKey:  "stacktrace",
			LineEnding:     zapcore.DefaultLineEnding,
			EncodeLevel:    zapcore.LowercaseLevelEncoder,
			EncodeTime:     zapcore.ISO8601TimeEncoder,
			EncodeDuration: zapcore.SecondsDurationEncoder,
			EncodeCaller:   zapcore.ShortCallerEncoder,
		},
	}

	logger, err := cfg.Build()
	if err != nil {
		return nil, err
	}

	return logger.With(zap.String("service", serviceName)), nil
}
