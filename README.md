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
| API Explorer | Query editor with schema validation and context-aware suggestions, tabs, history and saved queries, results with search, filters, column chooser, paging, CSV / Excel / Markdown export |
| Info | Data freshness per dataset (Eurex calendar aware) and the API changelog, filterable by followed products, `.ics` export |

Everything personal (watchlist, tabs, history, saved queries, display settings) is stored in the browser only.

## Run it

```bash
pip install -r requirements.txt
export DATABRICKS_TOKEN=...        # optional: only for the AI agent chat
python app.py                      # http://localhost:8080
```

Environment variables of the server (`app.py`):

| Variable | Default | Purpose |
|---|---|---|
| `DATABRICKS_APP_PORT` | `8080` | Port |
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
