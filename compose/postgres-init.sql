-- Runs automatically the FIRST time the postgres container starts with an
-- empty data volume (this is a Postgres image feature: anything mounted
-- into /docker-entrypoint-initdb.d/ runs once, in filename order, only on
-- first initialization). Matches the exact users/databases documented in
-- LOCAL_DEVELOPMENT.md.
CREATE USER auth WITH PASSWORD 'auth' CREATEDB;
CREATE DATABASE auth OWNER auth;

CREATE USER inventory WITH PASSWORD 'inventory' CREATEDB;
CREATE DATABASE inventory OWNER inventory;

CREATE DATABASE "order";
CREATE DATABASE payment;
