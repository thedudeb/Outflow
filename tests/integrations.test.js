import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOutflowApiClient, createOutflowMcpServer } from "../mcp/outflow-mcp.mjs";

const apiUrl = "https://outflow-test.supabase.co/functions/v1/integrations-api";
const token = "outflow_pat_abcdefghijklmnopqrstuvwxyzABCDEFGH012345678";

test("API client sends the personal token only in Authorization and returns data", async () => {
  const requests = [];
  const api = createOutflowApiClient({
    apiUrl,
    token,
    fetchImplementation: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ data: [{ id: "personal" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.deepEqual(await api("/v1/lists"), [{ id: "personal" }]);
  assert.equal(requests[0].url, `${apiUrl}/v1/lists`);
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${token}`);
  assert.equal(requests[0].init.body, undefined);
  assert.equal(JSON.stringify(requests[0]).includes(token), true);
});

test("API client rejects unsafe configuration and bounds service errors", async () => {
  assert.throws(() => createOutflowApiClient({ apiUrl: "http://example.com/api", token }), /OUTFLOW_API_URL/);
  assert.throws(() => createOutflowApiClient({ apiUrl, token: "wrong" }), /OUTFLOW_API_TOKEN/);
  const api = createOutflowApiClient({
    apiUrl,
    token,
    fetchImplementation: async () => new Response(JSON.stringify({ error: `Denied\n${"x".repeat(400)}` }), { status: 403 }),
  });
  await assert.rejects(api("/v1/lists"), (error) => {
    assert.equal(error.message.includes("\n"), false);
    assert.ok(error.message.length <= 240);
    return true;
  });
});

test("MCP advertises focused tools and delegates read and pause operations", async (t) => {
  const calls = [];
  const server = createOutflowMcpServer(async (path, options = {}) => {
    calls.push({ path, options });
    return path === "/v1/lists" ? [{ id: "personal", canWrite: true }] : { id: "netflix", paused: true };
  });
  const client = new Client({ name: "outflow-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), [
    "list_subscription_lists",
    "list_subscriptions",
    "create_subscription",
    "update_subscription",
    "delete_subscription",
  ]);
  const listResult = await client.callTool({ name: "list_subscription_lists", arguments: {} });
  assert.match(listResult.content[0].text, /personal/);
  await client.callTool({
    name: "update_subscription",
    arguments: { listId: "personal", subscriptionId: "netflix", paused: true },
  });
  assert.deepEqual(calls, [
    { path: "/v1/lists", options: {} },
    {
      path: "/v1/lists/personal/subscriptions/netflix",
      options: { method: "PATCH", body: { paused: true } },
    },
  ]);
});
