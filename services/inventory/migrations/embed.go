// Package migrations embeds the Inventory service's SQL migration files so
// they ship inside the compiled binary (and the Docker image) without
// needing to copy the migrations/ directory separately.
package migrations

import "embed"

// FS contains every *.sql file in this directory, applied in filename order
// by internal/db's migration runner.
//
//go:embed *.sql
var FS embed.FS
