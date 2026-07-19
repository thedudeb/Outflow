#!/bin/sh
set -eu

for command in initdb pg_ctl createdb psql; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing PostgreSQL command: $command" >&2
    exit 1
  fi
done

test_pg_dir=$(mktemp -d "${TMPDIR:-/tmp}/outflow-pg.XXXXXX")
test_pg_port=${OUTFLOW_TEST_PG_PORT:-55439}

cleanup() {
  pg_ctl -D "$test_pg_dir" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$test_pg_dir"
}
trap cleanup EXIT INT TERM

initdb -D "$test_pg_dir" -A trust --no-locale >/dev/null
pg_ctl -D "$test_pg_dir" -o "-h 127.0.0.1 -p $test_pg_port -c wal_level=logical" -l "$test_pg_dir/server.log" start >/dev/null
createdb -h 127.0.0.1 -p "$test_pg_port" outflow_test

psql -h 127.0.0.1 -p "$test_pg_port" -d outflow_test -v ON_ERROR_STOP=1 -f supabase/tests/bootstrap.sql >/dev/null
psql -h 127.0.0.1 -p "$test_pg_port" -d outflow_test -v ON_ERROR_STOP=1 -f supabase/migrations/20260719133000_account_foundation.sql >/dev/null
psql -h 127.0.0.1 -p "$test_pg_port" -d outflow_test -v ON_ERROR_STOP=1 -f supabase/tests/account_foundation.sql >/dev/null

echo "Account foundation database tests passed."
