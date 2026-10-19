#!/bin/sh
# Runs once on first Postgres start. Creates separate databases and least-privilege roles.
# Passwords come from the compose environment (.env); nothing is hard-coded here.
set -e
: "${KC_DB_PASSWORD:?}"
: "${API_DB_PASSWORD:?}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE keycloak LOGIN PASSWORD '${KC_DB_PASSWORD}';
CREATE DATABASE keycloak OWNER keycloak;
CREATE ROLE lemone_api LOGIN PASSWORD '${API_DB_PASSWORD}';
GRANT CONNECT ON DATABASE lemone TO lemone_api;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname lemone <<SQL
CREATE SCHEMA directory AUTHORIZATION lemone_api;
CREATE SCHEMA chat AUTHORIZATION lemone_api;
CREATE SCHEMA hr AUTHORIZATION lemone_api;
CREATE SCHEMA ops AUTHORIZATION lemone_api;
SQL
