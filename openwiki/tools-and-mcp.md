# Tool registry and MCP (`eurex_mcp/`)

The registry in `tools.py` is the single source of truth. The MCP server, hosted endpoint, REST wrapper, OpenAPI document and the Claude/OpenAI tool JSON are all derived from `tools.TOOLS`, so they cannot drift.

## Modules

| File | Role |
|---|---|
| `client.py` | `EurexClient`: stdlib `urllib` GraphQL POST. Retries 429/502/503/504 (max 2, honours `Retry-After`, capped at 10 s), 5 min in-memory cache keyed by query+variables, partial answers (data + errors) returned with `_partial_errors` and not cached. `EurexError.kind`: `network timeout auth rate_limit server http graphql response input`. |
| `tools.py` | `Tool(name, description, schema, handler)`, the `@_tool` decorator, argument validation (`validate_args`: required, unknown keys, types, bool is not int) and `call(client, name, args)`, which always returns `{'ok': True, ...}` or `{'ok': False, error, kind, hint}`. |
| `logic.py` | Pure, network-free rules ported from `explorer/*.js`: product ranking, trading status (`open`/`tes`/`closed`/`holiday`, Europe/Berlin, weekends closed), tick-rule resolution and price check (Decimal), TES tiers per expiration index, strike grouping. |
| `definitions.py` | `INSTRUCTIONS` text, `claude_tools()`, `openai_tools()`, `openapi(server_url)`. |
| `server.py` | MCP server (FastMCP / `MCPServer`, whichever `mcp` provides). Builds a typed wrapper per tool from its JSON schema, plus prompt `eurex_question` and resource `eurex://rules` (reads `ai.md`). `--http --port N` for streamable HTTP, else stdio. Console script `eurex-mcp`. |
| `remote.py` | Hand-written stateless JSON-RPC over `POST /mcp`: `initialize`, `ping`, `tools/list`, `tools/call`; batches up to 20; 64 KiB body cap; CORS; demo-key rate limiter. GET/DELETE return 405. |
| `rest.py` | `GET /api/v1/tools`, `POST /api/v1/tools/<name>`, `GET /openapi.json`. HTTP status from `kind`: input 400, auth 401, rate_limit 429, other failures 502. |
| `sdl.py` | Introspection query and `schema_to_sdl` for `schema.graphql`. |

## Tools

`get_api_info`, `search_products`, `get_product`, `get_market_status`, `get_tick_size`, `get_expirations`, `get_holidays`, `list_contracts`, `get_strikes`, `get_tes_thresholds`, `get_settlement_prices`, `get_changes`, `get_schema`, `run_graphql`.

Behaviour worth knowing:

- Product codes must match `^[A-Za-z0-9_.\-]{1,24}$` and are upper-cased.
- Results carry `as_of` (dataset validity date); partial upstream errors surface as `warnings`.
- `fetch_pages` follows `pageInfo` cursors up to `max_rows` (default 2000, page size 500) and reports truncation; if a requested sort is rejected by the schema it retries unsorted.
- `run_graphql` refuses `mutation`/`subscription`, and `Contracts`, `FlexibleContracts`, `SettlementPrices` without a `Product` filter; oversized results are truncated to `max_chars` (default 20000, max 200000).

## Adding or changing a tool

1. Add a handler with `@_tool(name, description, props, required)` in `tools.py`; raise `EurexError` for failures.
2. Put reusable rules in `logic.py` and mirror any Explorer behaviour (tests compare them).
3. Run `python scripts/build_ai_assets.py` to refresh `ai/*.json` and `llms-full.txt`; update `ai.md`/`ai.html` if the tool list is described there.
4. Add tests (see [Testing and CI](testing-and-ci.md)).
