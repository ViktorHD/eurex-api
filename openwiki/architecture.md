# Architecture

The repository ships one product in three faces over the same upstream API:

1. **Explorer**: a static, build-less browser app (`index.html`, `explorer/*.js`) that talks to the Eurex GraphQL API directly with the user's key.
2. **Agent tools**: a Python tool registry (`eurex_mcp/tools.py`) exposed as a local MCP server, a hosted MCP endpoint, and a REST wrapper.
3. **Agent docs and assets**: `ai.md`/`ai.html`/`llms.txt` plus files generated from the registry and the live schema.

```
Browser ──(GraphQL, user's key)──────────────────────────────┐
                                                             ▼
MCP client ─stdio─ eurex_mcp.server ─┐                 Eurex GraphQL API
MCP client ─POST /mcp─ remote.py ────┼─► tools.call ─► EurexClient (urllib, retry, 5 min cache)
REST client ─POST /api/v1/tools/<n> ─┘        │
                                              └─► logic.py (pure rules, no network)
```

## `app.py` (Flask)

- Registers two blueprints: `eurex_mcp.rest` (REST tools, `/openapi.json`) and `eurex_mcp.remote` (`/mcp`).
- `static_folder=None`: nothing is served automatically. Only `/`, `/ai.html`, `/llms.txt`, a fixed `AGENT_FILES` map (`ai.md`, `llms-full.txt`, `schema.graphql`, `ai/claude_tools.json`, `ai/openai_tools.json`) and `/explorer/<path>` are served.
- `/explorer/` only serves `.js .css .png .svg .ico`, rejects dot-segments and anything under `tests`.
- `/api/status` returns `{"status": "Flask is running"}`; `/api/*` responses are `Cache-Control: no-store`. All responses get `X-Content-Type-Options` and `Referrer-Policy`.
- Port from `DATABRICKS_APP_PORT` (default 8080); `app.yaml` runs `python app.py` (Databricks Apps).
- The front end is static, so GitHub Pages can host it; `/mcp` and the REST tools need the Flask host.

## Keys and quota

- Explorer: key typed by the user, kept in the browser. The shared demo key (in `explorer/app.js`, `eurex_mcp/client.py`, `ai.md`) is rate limited for everyone.
- Local MCP: `EUREX_API_KEY`, else the demo key.
- Hosted `/mcp`: caller's `X-DBP-APIKEY` or `Authorization: Bearer`; without a key the demo key is used with a per-address limit (`EUREX_DEMO_CALLS_PER_MINUTE`, default 20).
- REST: key header is mandatory (401 otherwise); no server-side key exists, by design.
