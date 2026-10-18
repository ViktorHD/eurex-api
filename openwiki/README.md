# OpenWiki: Eurex API Explorer

Developer wiki for this repository, written from the source and tests. Start here, then follow the page you need.
User-facing docs live in the root `README.md`; agent-facing instructions live in `ai.md`.

| Page | Covers |
|---|---|
| [Architecture](architecture.md) | Components, request flow, what is served where |
| [Tool registry and MCP](tools-and-mcp.md) | `eurex_mcp/`: registry, client, logic, MCP server, hosted `/mcp`, REST |
| [Explorer front end](explorer.md) | `index.html` + `explorer/`: modules and views |
| [Generated assets](generated-assets.md) | `ai/*.json`, `llms-full.txt`, `schema.graphql` and their scripts |
| [Testing and CI](testing-and-ci.md) | Pytest, Jest, workflows, evals |
| [Conventions and gotchas](conventions.md) | Rules a change must respect |
| [Overview map](overview.html) | Interactive architecture diagram (open in a browser; uses Google Fonts) |

Scope: the Eurex GraphQL reference-data API (`https://api.developer.deutsche-boerse.com/eurex-prod-graphql/`, header `X-DBP-APIKEY`). It is read-only; there is no live market data.
