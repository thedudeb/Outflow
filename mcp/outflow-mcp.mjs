#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const TOKEN_PATTERN = /^outflow_pat_[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const colors = ["#f59e0b", "#ef4444", "#22d3ee", "#84cc16", "#8b5cf6", "#94a3b8"];
const currencies = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "JPY", "CHF"];

function validApiUrl(value) {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    return !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === "https:" || (local && url.protocol === "http:"))
      && /\/functions\/v1\/integrations-api\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function safeErrorMessage(value) {
  if (typeof value !== "string") return "Outflow integration request failed.";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240) || "Outflow integration request failed.";
}

export function createOutflowApiClient({ apiUrl, token, fetchImplementation = fetch }) {
  const normalizedUrl = String(apiUrl || "").trim().replace(/\/$/, "");
  if (!validApiUrl(normalizedUrl)) {
    throw new Error("OUTFLOW_API_URL must be the HTTPS integrations-api Edge Function URL.");
  }
  if (!TOKEN_PATTERN.test(String(token || ""))) {
    throw new Error("OUTFLOW_API_TOKEN must be a valid Outflow personal access token.");
  }

  return async function request(path, { method = "GET", body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImplementation(`${normalizedUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error("Outflow returned more data than the MCP safety limit allows.");
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        throw new Error("Outflow returned an unreadable response.");
      }
      if (!response.ok) throw new Error(safeErrorMessage(payload?.error));
      return payload?.data;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Outflow integration request timed out.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

const listId = z.string().regex(ID_PATTERN).describe("Outflow synced subscription list identifier");
const subscriptionId = z.string().regex(ID_PATTERN).describe("Outflow subscription identifier");
const date = z.string().regex(DATE_PATTERN).describe("Billing date in YYYY-MM-DD format");
const amount = z.number().positive().max(1_000_000_000);
const currency = z.enum(currencies);
const cycle = z.enum(["weekly", "monthly", "yearly"]);
const color = z.enum(colors);
const tags = z.array(z.string().trim().min(1).max(30)).max(10);
const reminderLeadDays = z.array(z.number().int().min(0).max(365)).max(12);

export function createOutflowMcpServer(apiRequest) {
  if (typeof apiRequest !== "function") throw new TypeError("An Outflow API client is required.");
  const server = new McpServer({
    name: "outflow",
    version: "1.0.0",
  }, {
    instructions: "Use list_subscription_lists before reading or changing subscriptions. Confirm destructive changes with the user. Outflow amounts are stored in each subscription's currency and are not converted.",
  });

  server.registerTool("list_subscription_lists", {
    title: "List subscription lists",
    description: "List the signed-in Outflow account's synced subscription lists and whether this token can write to each one.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => toolResult(await apiRequest("/v1/lists")));

  server.registerTool("list_subscriptions", {
    title: "List subscriptions",
    description: "Read subscriptions from one synced Outflow list, sorted by next billing date.",
    inputSchema: {
      listId,
      includePaused: z.boolean().optional().default(true),
      dueBefore: date.optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ listId: id, includePaused, dueBefore }) => {
    const query = new URLSearchParams({ includePaused: String(includePaused) });
    if (dueBefore) query.set("dueBefore", dueBefore);
    return toolResult(await apiRequest(`/v1/lists/${encodeURIComponent(id)}/subscriptions?${query}`));
  });

  server.registerTool("create_subscription", {
    title: "Create subscription",
    description: "Add a recurring charge to a writable synced Outflow subscription list.",
    inputSchema: {
      listId,
      name: z.string().trim().min(1).max(100),
      amount,
      currency,
      cycle,
      nextBillingDate: date,
      category: z.string().trim().min(1).max(60),
      tags: tags.optional().default([]),
      color: color.optional().default("#f59e0b"),
      trialEndDate: date.nullable().optional().default(null),
      reminderLeadDays: reminderLeadDays.optional().default([7]),
      paused: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ listId: id, ...subscription }) => toolResult(await apiRequest(
    `/v1/lists/${encodeURIComponent(id)}/subscriptions`,
    { method: "POST", body: subscription },
  )));

  server.registerTool("update_subscription", {
    title: "Update subscription",
    description: "Change or pause an existing recurring charge in a writable synced Outflow subscription list.",
    inputSchema: {
      listId,
      subscriptionId,
      name: z.string().trim().min(1).max(100).optional(),
      amount: amount.optional(),
      currency: currency.optional(),
      cycle: cycle.optional(),
      nextBillingDate: date.optional(),
      category: z.string().trim().min(1).max(60).optional(),
      tags: tags.optional(),
      color: color.optional(),
      trialEndDate: date.nullable().optional(),
      reminderLeadDays: reminderLeadDays.optional(),
      paused: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ listId: id, subscriptionId: recordId, ...changes }) => toolResult(await apiRequest(
    `/v1/lists/${encodeURIComponent(id)}/subscriptions/${encodeURIComponent(recordId)}`,
    { method: "PATCH", body: changes },
  )));

  server.registerTool("delete_subscription", {
    title: "Delete subscription",
    description: "Permanently delete a recurring charge from a writable synced Outflow subscription list.",
    inputSchema: { listId, subscriptionId },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ listId: id, subscriptionId: recordId }) => toolResult(await apiRequest(
    `/v1/lists/${encodeURIComponent(id)}/subscriptions/${encodeURIComponent(recordId)}`,
    { method: "DELETE" },
  )));

  return server;
}

export async function startOutflowMcpServer(env = process.env) {
  const apiRequest = createOutflowApiClient({
    apiUrl: env.OUTFLOW_API_URL,
    token: env.OUTFLOW_API_TOKEN,
  });
  const server = createOutflowMcpServer(apiRequest);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startOutflowMcpServer().catch((error) => {
    console.error(safeErrorMessage(error instanceof Error ? error.message : "Outflow MCP failed to start."));
    process.exitCode = 1;
  });
}
