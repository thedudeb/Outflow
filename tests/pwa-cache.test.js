import assert from "node:assert/strict";
import test from "node:test";
import { cacheVersion, normalizePublicBase } from "../vite.config.js";

test("public bases are canonical path-only scopes", () => {
  assert.equal(normalizePublicBase(), "/");
  assert.equal(normalizePublicBase("/Outflow"), "/Outflow/");
  assert.equal(normalizePublicBase("//Outflow//preview/"), "/Outflow/preview/");
  assert.throws(() => normalizePublicBase("https://outflow.example/"), /absolute path/);
  assert.throws(() => normalizePublicBase("/Outflow/?draft=true"), /without a query or fragment/);
});

test("cache fingerprints are deterministic regardless of asset order", () => {
  const entries = [
    { path: "/index.html", content: "<main>Outflow</main>" },
    { path: "/manifest.webmanifest", content: '{"name":"Outflow"}' },
  ];

  assert.equal(cacheVersion(entries), cacheVersion([...entries].reverse()));
  assert.match(cacheVersion(entries), /^[a-f0-9]{12}$/);
});

test("cache fingerprints change when a stable asset path changes content", () => {
  const initial = [
    { path: "/manifest.webmanifest", content: '{"name":"Outflow"}' },
    { path: "/outflow-icon-192.png", content: Buffer.from([1, 2, 3]) },
  ];
  const revisedManifest = initial.map((entry) => entry.path === "/manifest.webmanifest"
    ? { ...entry, content: '{"name":"Outflow","display":"standalone"}' }
    : entry);
  const revisedIcon = initial.map((entry) => entry.path === "/outflow-icon-192.png"
    ? { ...entry, content: Buffer.from([1, 2, 4]) }
    : entry);

  assert.notEqual(cacheVersion(initial), cacheVersion(revisedManifest));
  assert.notEqual(cacheVersion(initial), cacheVersion(revisedIcon));
});
