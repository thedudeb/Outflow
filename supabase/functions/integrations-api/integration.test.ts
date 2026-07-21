import {
  allowedBrowserOrigin,
  bearerToken,
  integrationRoute,
  MAX_INTEGRATION_BODY_BYTES,
  readJsonObjectBody,
  validDueBefore,
  validRouteIdentifiers,
  withoutSubscriptionId,
} from "./integration.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const token = "outflow_pat_abcdefghijklmnopqrstuvwxyzABCDEFGH012345678";

Deno.test("integration credentials require the exact bearer token shape", () => {
  assert(bearerToken(`Bearer ${token}`) === token, "valid token was rejected");
  assert(bearerToken(token) === "", "unprefixed token was accepted");
  assert(bearerToken(`bearer ${token}`) === "", "non-canonical bearer header was accepted");
  assert(bearerToken(`Bearer ${token} trailing`) === "", "token suffix was accepted");
});

Deno.test("integration routes remain within list and subscription resources", () => {
  const list = integrationRoute(new URL("https://example.test/functions/v1/integrations-api/v1/lists/team-one/subscriptions"));
  assert(list.kind === "subscriptions" && list.listId === "team-one", "list route was not parsed");
  const record = integrationRoute(new URL("https://example.test/functions/v1/integrations-api/v1/lists/team-one/subscriptions/netflix"));
  assert(record.kind === "subscription" && record.subscriptionId === "netflix", "record route was not parsed");
  assert(validRouteIdentifiers(record), "valid route identifiers were rejected");
  assert(!validRouteIdentifiers(integrationRoute(new URL("https://example.test/functions/v1/integrations-api/v1/lists/team%2Fother/subscriptions"))), "path separator identifier was accepted");
  assert(integrationRoute(new URL("https://example.test/functions/v1/integrations-api/v1/admin")).kind === "missing", "unsupported route was accepted");
});

Deno.test("browser origins, query dates, and create payload identifiers are bounded", () => {
  assert(allowedBrowserOrigin("", "https://outflow.example"), "non-browser caller was rejected");
  assert(allowedBrowserOrigin("https://outflow.example", "https://outflow.example"), "configured browser origin was rejected");
  assert(!allowedBrowserOrigin("https://attacker.example", "https://outflow.example"), "unconfigured browser origin was accepted");
  assert(validDueBefore("2028-02-29"), "valid leap date was rejected");
  assert(!validDueBefore("2027-02-29"), "invalid calendar date was accepted");
  assert(withoutSubscriptionId({ id: "record-1", paused: true })?.payload.paused === true, "valid create payload was rejected");
  assert(withoutSubscriptionId({ id: "../record", paused: true }) === null, "invalid create identifier was accepted");
});

Deno.test("integration request bodies are parsed as bounded JSON objects", async () => {
  const parsed = await readJsonObjectBody(new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ paused: true }),
  }));
  assert(parsed?.paused === true, "valid object body was rejected");
  assert(await readJsonObjectBody(new Request("https://example.test", {
    method: "POST",
    body: "[]",
  })) === null, "array body was accepted");
  assert(await readJsonObjectBody(new Request("https://example.test", {
    method: "POST",
    body: "x".repeat(MAX_INTEGRATION_BODY_BYTES + 1),
  })) === null, "oversized streaming body was accepted");
});
