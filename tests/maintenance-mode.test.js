import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("maintenance mode uses a protected server control and private audit log", () => {
  const migration = read("supabase/migrations/20260721020000_app_maintenance_mode.sql");

  assert.match(migration, /auth\.jwt\(\) -> 'app_metadata' ->> 'outflow_role'/);
  assert.match(migration, /revoke all on table public\.app_service_status, public\.app_service_status_events/);
  assert.match(migration, /grant execute on function public\.read_app_service_status\(\) to anon, authenticated/);
  assert.match(migration, /grant execute on function public\.set_app_maintenance_mode\(boolean\) to authenticated/);
  assert.doesNotMatch(migration, /grant .* on table public\.app_service_status.* to anon/i);
  assert.match(migration, /insert into public\.app_service_status_events/);
});

test("the admin console is recoverable while customer views are blocked", () => {
  const app = read("src/App.jsx");

  assert.match(app, /const ADMIN_VIEW = "admin"/);
  assert.match(app, /view !== ADMIN_VIEW && service\.status\.maintenanceEnabled/);
  assert.match(app, /view === ADMIN_VIEW/);
  assert.match(app, /Enable maintenance/);
  assert.match(app, /Confirm enable/);
  assert.match(app, /Disable maintenance/);
  assert.match(app, /session\?\.user\?\.app_metadata\?\.outflow_role === "admin"/);
});

test("maintenance operations and limitations are documented", () => {
  const docs = read("docs/maintenance-mode.md");
  assert.match(docs, /app_metadata/);
  assert.match(docs, /15 seconds/);
  assert.match(docs, /offline/i);
  assert.match(docs, /audit/i);
  assert.match(docs, /\?view=admin/);
});
