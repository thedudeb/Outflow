import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  browserAuthStorageKey,
  browserSyncCheckNames,
  buildBrowserSyncReport,
  provisionBrowserSyncFixture,
  resolveBrowserSyncAcceptanceConfig,
} from "../scripts/staging-browser-sync.mjs";

const projectRef = "abcdefghijklmnopqrst";
const projectUrl = `https://${projectRef}.supabase.co`;
const publishableKey = `sb_publishable_${"p".repeat(24)}`;
const secretKey = `sb_secret_${"s".repeat(24)}`;

function environment(overrides = {}) {
  return {
    SUPABASE_URL: projectUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SECRET_KEY: secretKey,
    OUTFLOW_APP_URL: "https://staging.outflow.example",
    OUTFLOW_ACCEPTANCE_PROJECT_REF: projectRef,
    OUTFLOW_ACCEPTANCE_MODE: "staging",
    ...overrides,
  };
}

test("browser-sync configuration binds live browser setup to one hosted staging project", () => {
  const valid = resolveBrowserSyncAcceptanceConfig(environment());
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.appOrigin, "https://staging.outflow.example");
  assert.equal(browserAuthStorageKey(projectUrl), `sb-${projectRef}-auth-token`);

  const invalid = resolveBrowserSyncAcceptanceConfig(environment({
    SUPABASE_URL: "http://127.0.0.1:54321",
    OUTFLOW_APP_URL: "http://localhost:5173",
    OUTFLOW_ACCEPTANCE_MODE: "production",
  }));
  assert.ok(invalid.errors.some((error) => error.includes("SUPABASE_URL")));
  assert.ok(invalid.errors.some((error) => error.includes("OUTFLOW_APP_URL")));
  assert.ok(invalid.errors.some((error) => error.includes("OUTFLOW_ACCEPTANCE_MODE")));
  assert.throws(() => browserAuthStorageKey("https://example.com"), /hosted Supabase project URL/);
});

test("browser-sync fixture provisions owner/editor sessions and reverses identity cleanup", async () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const editorId = "22222222-2222-4222-8222-222222222222";
  const createdUsers = [];
  const deletedUsers = [];
  const tableCalls = [];
  let signInCount = 0;

  const admin = {
    auth: {
      admin: {
        async createUser(payload) {
          createdUsers.push(payload);
          const id = createdUsers.length === 1 ? ownerId : editorId;
          return { data: { user: { id } }, error: null };
        },
        async deleteUser(userId) {
          deletedUsers.push(userId);
          return { data: {}, error: null };
        },
      },
    },
    from(table) {
      return {
        async upsert(payload, options) {
          tableCalls.push({ table, action: "upsert", payload, options });
          return { data: payload, error: null };
        },
        insert(payload) {
          tableCalls.push({ table, action: "insert", payload });
          return {
            async select() {
              return { data: [payload], error: null };
            },
          };
        },
      };
    },
  };
  function authenticatedClient(userId) {
    return {
      auth: {
        async signInWithPassword() {
          signInCount += 1;
          return {
            data: {
              user: { id: userId },
              session: {
                access_token: `access-${signInCount}`,
                refresh_token: `refresh-${signInCount}`,
                user: { id: userId },
              },
            },
            error: null,
          };
        },
      },
      async rpc(name, body) {
        assert.equal(name, "migrate_guest_workspace");
        assert.equal(body.workspace_payload.ledgers.length, 2);
        return { data: { ledgerCount: 2, subscriptionCount: 1 }, error: null };
      },
    };
  }

  let publicClientCount = 0;
  const createClient = (_url, key) => {
    if (key === secretKey) return admin;
    publicClientCount += 1;
    return authenticatedClient(publicClientCount === 1 ? ownerId : editorId);
  };
  const fixture = await provisionBrowserSyncFixture({ projectUrl, publishableKey, secretKey }, { createClient });

  assert.equal(createdUsers.length, 2);
  assert.ok(createdUsers.every((user) => user.email_confirm === true));
  assert.match(fixture.teamId, /^browser-team-[a-f0-9]{16}$/);
  assert.equal(fixture.teamName, "Hosted Sync Acceptance");
  assert.equal(fixture.subscriptionName, "Hosted Sync Charge");
  assert.equal(fixture.ownerSession.user.id, ownerId);
  assert.equal(fixture.editorSession.user.id, editorId);
  assert.equal(tableCalls.find(({ table }) => table === "entitlements")?.payload.status, "active");
  assert.deepEqual(tableCalls.find(({ table }) => table === "ledger_members")?.payload, {
    ledger_id: fixture.teamId,
    user_id: editorId,
    role: "editor",
  });

  await fixture.cleanup();
  assert.deepEqual(deletedUsers, [editorId, ownerId]);
});

test("browser-sync fixture removes a partially created identity when setup fails", async () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const deletedUsers = [];
  let createCount = 0;
  const admin = {
    auth: {
      admin: {
        async createUser() {
          createCount += 1;
          return createCount === 1
            ? { data: { user: { id: ownerId } }, error: null }
            : { data: null, error: { code: "synthetic_failure" } };
        },
        async deleteUser(userId) {
          deletedUsers.push(userId);
          return { data: {}, error: null };
        },
      },
    },
  };

  await assert.rejects(
    provisionBrowserSyncFixture(
      { projectUrl, publishableKey, secretKey },
      { createClient: () => admin },
    ),
    /browser editor setup: remote operation failed \(synthetic_failure\)/,
  );
  assert.deepEqual(deletedUsers, [ownerId]);
});

test("browser-sync report records only fixed viewport evidence", () => {
  const reportFor = (viewport) => buildBrowserSyncReport({
    projectUrl,
    appOrigin: "https://staging.outflow.example",
    completed: [...browserSyncCheckNames],
    viewport,
    commit: "abcdef1234567890",
    actor: "outflow-ci",
    runUrl: "https://github.com/thedudeb/Outflow/actions/runs/123",
    recordedAt: "2026-07-19T12:00:00.000Z",
  });
  const report = reportFor("desktop-chromium");

  assert.match(report, /PASS\*\* \(10 browser-visible checks\)/);
  assert.match(report, /PASS \/ browser conflict rejection/);
  assert.match(report, /PASS \/ Realtime disconnect visibility/);
  assert.match(report, /PASS \/ synchronized final state/);
  assert.match(report, /branded Safari behavior/);
  assert.match(report, /screenshots, traces, and videos/);
  assert.doesNotMatch(report, /sb_(?:publishable|secret)_|@example\.com|Bearer\s|refresh-|access-/i);
  for (const viewport of ["mobile-chromium", "desktop-firefox", "desktop-webkit"]) {
    assert.match(reportFor(viewport), new RegExp(`Staging Browser Sync / ${viewport}`));
  }
  assert.match(reportFor("mobile-firefox"), /Staging Browser Sync \/ not recorded/);
  assert.throws(() => buildBrowserSyncReport({
    projectUrl,
    appOrigin: "https://staging.outflow.example",
    completed: browserSyncCheckNames.slice(0, -1),
    viewport: "desktop-chromium",
  }), /complete ordered browser-sync inventory/);
});

test("browser-sync workflow is manual, protected, main-only, and artifact-free", async () => {
  const [workflow, config, spec, quality] = await Promise.all([
    readFile(new URL("../.github/workflows/staging-browser-sync.yml", import.meta.url), "utf8"),
    readFile(new URL("../playwright.staging-sync.config.js", import.meta.url), "utf8"),
    readFile(new URL("./staging-browser-sync/hosted-browser-sync.spec.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8"),
  ]);

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\b(push|pull_request|schedule):/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /permissions:\n\s+contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /OUTFLOW_ACCEPTANCE_MODE: staging/);
  assert.match(workflow, /npm run test:staging-browser-sync/);
  assert.match(workflow, /npm run check:staging-browser-sync/);
  assert.doesNotMatch(workflow, /upload-artifact|STRIPE|RESEND|WEBHOOK|CRON/);
  const liveStep = workflow.indexOf("- name: Run browser-visible hosted sync acceptance");
  assert.ok(liveStep > 0);
  assert.doesNotMatch(workflow.slice(0, liveStep), /OUTFLOW_SUPABASE_SECRET_KEY/);
  assert.match(workflow.slice(liveStep), /secrets\.OUTFLOW_SUPABASE_SECRET_KEY/);

  assert.match(config, /name: "desktop-chromium"/);
  assert.match(config, /name: "mobile-chromium"/);
  assert.match(config, /name: "desktop-firefox"/);
  assert.match(config, /name: "desktop-webkit"/);
  assert.match(config, /workers: 1/);
  assert.match(config, /trace: "off"/);
  assert.match(config, /screenshot: "off"/);
  assert.match(config, /video: "off"/);
  assert.match(workflow, /playwright install --with-deps chromium firefox webkit/);

  assert.match(spec, /browser\.newContext/);
  assert.match(spec, /localStorage\.setItem\(storageKey/);
  assert.match(spec, /class AcceptanceWebSocket extends NativeWebSocket/);
  assert.match(spec, /dropChanges\(true\)/);
  assert.match(spec, /\.disconnect\(\)/);
  assert.match(spec, /Realtime connection interrupted/);
  assert.match(spec, /Cloud changed at revision 3/);
  assert.match(spec, /Another cloud revision is available/);
  assert.match(spec, /getByText\("synced"/);
  assert.match(spec, /finally \{/);
  assert.match(spec, /await fixture\.cleanup\(\)/);
  assert.doesNotMatch(spec, /console\.(?:log|info|debug)/);
  assert.match(quality, /npm run test:staging-browser-sync/);
  assert.match(quality, /playwright install --with-deps chromium firefox webkit/);
});

test("configured-service sync matrix includes Chromium mobile plus three desktop engines", async () => {
  const source = await readFile(new URL("../playwright.account.config.js", import.meta.url), "utf8");
  assert.match(source, /name: "desktop-chromium"/);
  assert.match(source, /name: "mobile-chromium"/);
  assert.match(source, /name: "desktop-firefox"/);
  assert.match(source, /name: "desktop-webkit"/);
  assert.match(source, /devices\["Desktop Firefox"\]/);
  assert.match(source, /devices\["Desktop Safari"\]/);
});
