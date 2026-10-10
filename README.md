# Eurex API Explorer

A web app for the Eurex GraphQL reference-data API, for Eurex traders and clearers: an explorer for queries, plus
views for products, trading hours, strikes, expirations and API changes.

## Views

| View | What it does |
|---|---|
| API Overview | Entry point with example queries per data domain |
| Products | Search by code, name, ISIN or vendor code; follow products (watchlist) |
| Product card | Master data, trading hours with live status, tick rules with a price checker, TES lot sizes per expiration, upcoming expirations and holidays (`.ics`), settlement price history, vendor codes. Printable. |
| Strike Window | Listed strikes per contract date, delta coverage, request for additional strikes |
| Trading Hours | 24 h timeline per product, open / TES / closed / holiday status, timezones, watchlist filter |
| Calendar | Expirations and exchange holidays of followed products by month, `.ics` export |
| API Explorer | Query editor with schema validation and context-aware suggestions, tabs (one running query per tab, drag to reorder, duplicate, context menu), history and saved queries, results with search, filters, column chooser, paging, CSV / Excel / Markdown export |
| Info | Data freshness per dataset (Eurex calendar aware) and the API changelog, filterable by followed products, `.ics` export |

Everything personal (watchlist, tabs, history, saved queries, display settings) is stored in the browser only.

## Run it

```bash
pip install -r requirements.txt
export OPENROUTER_API_KEY=...      # optional: enables the free built-in assistant (no key needed by users)
export DATABRICKS_TOKEN=...        # optional: enables the Databricks agent
python app.py                      # http://localhost:8080
```

Environment variables of the server (`app.py`):

| Variable | Default | Purpose |
|---|---|---|
| `DATABRICKS_APP_PORT` | `8080` | Port |
| `OPENROUTER_API_KEY` | none | Server-side key for the built-in assistant (`/api/llm`); users type no key. Without it the option is hidden. Create a free key at openrouter.ai |
| `LLM_API_KEY` | none | Same, for any other OpenAI-compatible provider (takes precedence over `OPENROUTER_API_KEY`) |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | Base URL of the OpenAI-compatible API (e.g. Groq: `https://api.groq.com/openai/v1`) |
| `LLM_MODEL` | `openai/gpt-oss-120b:free` | Model; it must support tool calling. Free model names on OpenRouter change, see openrouter.ai/models?supported_parameters=tools&max_price=0 |
| `DATABRICKS_TOKEN` | none | Token for the agent endpoint; without it the agent chat answers 503 |
| `DATABRICKS_ENDPOINT_URL` | built-in | Agent serving endpoint |
| `ALLOWED_ORIGINS` | none | Extra host names allowed to call `/api/databricks` (when a proxy rewrites the host) |
| `AGENT_RATE_LIMIT_PER_MINUTE` | `20` | Per client |
| `AGENT_GLOBAL_LIMIT_PER_MINUTE` | `120` | All clients together |

## Test

```bash
npm ci && npm test                          # front end (Jest)
pip install -r requirements-dev.txt && pytest   # server
```

## Layout

- `index.html`, `explorer/`: the front end (plain ES modules, no build step). `app.js` wires the views;
  each view and helper is its own module with tests in `explorer/tests/`.
- `app.py`: serves the front end and proxies the AI agent (rate limited, same-origin only).
- `docs/api-data-proposals.md`: proposed new API queries from public Eurex information.
- `notebooks/`: tutorials and recipes for the API.
