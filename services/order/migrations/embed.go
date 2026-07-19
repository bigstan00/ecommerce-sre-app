// Package migrations embeds the SQL schema migration(s) so the server
// binary can apply them on startup without depending on the working
// directory or a separate deploy step. The .sql file(s) in this directory
// remain the single source of truth — this file only exposes their
// contents to Go code via go:embed.
package migrations

import _ "embed"

// Schema is the full contents of 001_create_orders.sql. Every statement in
// it is idempotent (CREATE ... IF NOT EXISTS), so applying it on every
// startup is safe.
//
//go:embed 001_create_orders.sql
var Schema string
