# API And MCP Integrations

**Status:** Implemented for configured account builds; hosted deployment pending

Outflow Pro accounts can create revocable personal access tokens from **Account / Pro > API / MCP access**. Integrations operate only on synced subscription lists. Device-only guest data is never exposed.

## Access Boundary

- Tokens use the `outflow_pat_` prefix, are displayed once, and are stored by Outflow only as SHA-256 hashes.
- Tokens expire after 30, 90, or 365 days and can be revoked immediately from Account / Pro.
- Each request requires an active Pro entitlement and current membership in the requested synced list.
- Read access follows list membership. Create, update, pause, and delete require owner or editor access plus the same Pro ownership rules as browser synchronization.
- The service permits 300 requests per token in a rolling ten-minute window. Request bodies are limited to 32 KiB and responses to at most 500 subscriptions per list.
- Maintenance mode stops API and MCP traffic with HTTP `503`.
- Token metadata includes label, scopes, creation, expiry, revocation, and last-used time. Plaintext credentials, request bodies, and subscription values are not retained in integration logs by this implementation.

Treat a token like a password. Keep it out of prompts, screenshots, shell history, source control, issue reports, and shared configuration. Revoke it immediately if it may have been exposed.

## HTTP API

The base URL is shown in Account / Pro and has this shape:

```text
https://PROJECT.supabase.co/functions/v1/integrations-api
```

Authenticate every request with the personal access token:

```sh
curl "$OUTFLOW_API_URL/v1/lists" \
  -H "Authorization: Bearer $OUTFLOW_API_TOKEN"
```

Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1` | Verify the token and API version |
| `GET` | `/v1/lists` | List visible synced subscription lists |
| `GET` | `/v1/lists/{listId}/subscriptions` | List subscriptions by next billing date |
| `POST` | `/v1/lists/{listId}/subscriptions` | Create a subscription |
| `PATCH` | `/v1/lists/{listId}/subscriptions/{subscriptionId}` | Update or pause a subscription |
| `DELETE` | `/v1/lists/{listId}/subscriptions/{subscriptionId}` | Delete a subscription |

`GET subscriptions` accepts `includePaused=false` and `dueBefore=YYYY-MM-DD`. Create requests may provide an `id`; otherwise Outflow generates one. The body fields are `name`, `amount`, `currency`, `cycle`, `nextBillingDate`, `category`, `tags`, `color`, `trialEndDate`, `reminderLeadDays`, and `paused`. Patch requests accept any subset.

```sh
curl "$OUTFLOW_API_URL/v1/lists/LIST_ID/subscriptions" \
  -X POST \
  -H "Authorization: Bearer $OUTFLOW_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Example Cloud",
    "amount": 12.50,
    "currency": "CAD",
    "cycle": "monthly",
    "nextBillingDate": "2026-08-15",
    "category": "Software",
    "tags": ["work"],
    "color": "#22d3ee",
    "trialEndDate": null,
    "reminderLeadDays": [3, 7],
    "paused": false
  }'
```

The machine-readable contract is [OpenAPI 3.1](outflow-api.openapi.yaml).

## MCP Server

The repository includes a local stdio server built with the official MCP TypeScript SDK. It requires Node.js 20 or newer and delegates all authorization and data changes to the HTTP API.

Install repository dependencies with `npm ci`, then configure an MCP host with an absolute path:

```json
{
  "mcpServers": {
    "outflow": {
      "command": "node",
      "args": ["/absolute/path/to/Outflow/mcp/outflow-mcp.mjs"],
      "env": {
        "OUTFLOW_API_URL": "https://PROJECT.supabase.co/functions/v1/integrations-api",
        "OUTFLOW_API_TOKEN": "outflow_pat_REPLACE_WITH_ONE_TIME_TOKEN"
      }
    }
  }
}
```

The server exposes:

- `list_subscription_lists`
- `list_subscriptions`
- `create_subscription`
- `update_subscription`
- `delete_subscription`

MCP hosts should ask for user approval before tool calls, especially deletion. Outflow also marks the delete tool as destructive in MCP metadata.

## Operator Deployment

Apply all migrations, deploy `integrations-api` using the checked-in `supabase/config.toml`, and run:

```sh
npm run test:account-foundation
npm run test:function-types
npm run test:function-runtime
npm run test:integrations
npm run test:account-service
```

Do not add a service-role key, Supabase publishable key, or personal access token to MCP arguments, committed files, browser variables, telemetry, or deployment summaries.
