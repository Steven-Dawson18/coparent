#!/usr/bin/env bash
set -euo pipefail

PG_BIN="${PG_BIN:-/Applications/Postgres.app/Contents/Versions/latest/bin}"
NODE_BIN="${NODE_BIN:-/Users/steve/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin}"
TEST_DATA_DIR="$(mktemp -d /private/tmp/coparent-rls.XXXXXX)"
TEST_DB_PORT="$((55000 + RANDOM % 5000))"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$TEST_DATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  if [[ "$TEST_DATA_DIR" == /private/tmp/coparent-rls.* ]]; then
    rm -rf -- "$TEST_DATA_DIR"
  fi
}
trap cleanup EXIT

export PATH="$NODE_BIN:$PG_BIN:$PATH"
"$PG_BIN/initdb" -D "$TEST_DATA_DIR" -A trust -U postgres >/dev/null
"$PG_BIN/pg_ctl" -D "$TEST_DATA_DIR" -o "-p $TEST_DB_PORT -h 127.0.0.1 -c shared_memory_type=mmap" -w start >/dev/null
"$PG_BIN/createdb" -h 127.0.0.1 -p "$TEST_DB_PORT" -U postgres coparent_rls_test

export ADMIN_DATABASE_URL="postgresql://postgres@127.0.0.1:$TEST_DB_PORT/coparent_rls_test"
export DATABASE_URL="$ADMIN_DATABASE_URL"
npx prisma migrate deploy

"$PG_BIN/psql" "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE coparent_test LOGIN PASSWORD 'test-only-password';
GRANT coparent_runtime TO coparent_test;
SQL

export RUNTIME_DATABASE_URL="postgresql://coparent_test:test-only-password@127.0.0.1:$TEST_DB_PORT/coparent_rls_test"
npx jest --config ./test/jest-rls.json --runInBand
