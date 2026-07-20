import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { outflowWebSecurity, webContentSecurityPolicy } from "../vite.config.js";

test("public guest policy permits local application capabilities without provider access", () => {
  const policy = webContentSecurityPolicy();
  assert.equal(policy, [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "img-src 'self' blob: data:",
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
  ].join("; "));
  assert.doesNotMatch(policy, /https:|wss:|ipc:|asset:|frame-ancestors|report-uri|sandbox/);
});

test("configured and native policies add only exact required origins and schemes", () => {
  const hosted = webContentSecurityPolicy({ VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/" });
  assert.match(hosted, /connect-src 'self' https:\/\/abcdefghijklmnopqrst\.supabase\.co wss:\/\/abcdefghijklmnopqrst\.supabase\.co/);
  assert.doesNotMatch(hosted, /\*\.supabase|ipc:|asset:/);

  const native = webContentSecurityPolicy({ TAURI_ENV_PLATFORM: "darwin" });
  assert.match(native, /connect-src 'self' ipc: http:\/\/ipc\.localhost/);
  assert.match(native, /img-src 'self' blob: data: asset: http:\/\/asset\.localhost/);

  for (const invalid of [
    "http://abcdefghijklmnopqrst.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co/rest/v1",
    "https://*.supabase.co",
    "https://example.com",
  ]) {
    assert.throws(
      () => webContentSecurityPolicy({ VITE_SUPABASE_URL: invalid }),
      /VITE_SUPABASE_URL must be an exact hosted Supabase HTTPS origin/,
    );
  }
});

test("production HTML receives early CSP and no-referrer metadata", () => {
  const plugin = outflowWebSecurity();
  assert.equal(plugin.apply, "build");
  assert.equal(plugin.enforce, "pre");
  assert.deepEqual(plugin.transformIndexHtml(), [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: webContentSecurityPolicy() },
      injectTo: "head-pre",
    },
    {
      tag: "meta",
      attrs: { name: "referrer", content: "no-referrer" },
      injectTo: "head-pre",
    },
  ]);

  const localFixture = outflowWebSecurity({ VITE_SUPABASE_URL: "http://127.0.0.1:4181/supabase" });
  assert.equal(localFixture.apply, "build");
  assert.throws(
    () => localFixture.transformIndexHtml(),
    /VITE_SUPABASE_URL must be an exact hosted Supabase HTTPS origin/,
  );
});

test("web security policy is a documented CI, PWA, and deployed-site contract", async () => {
  const [packageSource, quality, pwa, deployment, documentation, privacy, prd] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8"),
    readFile(new URL("./pwa/pwa.spec.js", import.meta.url), "utf8"),
    readFile(new URL("./deployment/live-web.spec.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/web-security.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/privacy-policy.md", import.meta.url), "utf8"),
    readFile(new URL("../prds/outflow-product-vision.md", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.scripts["test:web-security"], "node --test tests/web-security.test.js");
  assert.match(quality, /npm run test:web-security/);
  assert.match(pwa, /Content-Security-Policy/);
  assert.match(pwa, /no-referrer/);
  assert.match(deployment, /Content-Security-Policy/);
  assert.match(deployment, /no-referrer/);
  assert.match(documentation, /meta-delivered policy cannot enforce `frame-ancestors`/);
  assert.match(privacy, /test:web-security/);
  assert.match(prd, /build-generated public web security policy/);
});
