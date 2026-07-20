import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("the public web release deploys only a tested successful main artifact", async () => {
  const source = await readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");

  assert.match(source, /workflow_run:\n\s+workflows: \[Quality\]\n\s+branches: \[main\]\n\s+types: \[completed\]/);
  assert.match(source, /workflow_run\.event == 'push'/);
  assert.match(source, /workflow_run\.conclusion == 'success'/);
  assert.match(source, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /npm run test:pwa-cache/);
  assert.match(source, /npm run test:pwa:pages/);
  assert.match(source, /actions\/upload-pages-artifact@v4\n\s+with:\n\s+path: dist/);
  assert.match(source, /needs: build/);
  assert.match(source, /environment:\n\s+name: github-pages/);
  assert.match(source, /permissions:\n\s+contents: read\n\s+pages: write\n\s+id-token: write/);
  assert.doesNotMatch(source, /VITE_SUPABASE|SUPABASE_SECRET|SERVICE_ROLE|STRIPE_|RESEND_/);
  assert.doesNotMatch(source, /^\s{2}push:/m);
});
