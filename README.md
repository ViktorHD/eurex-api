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

## AI agents

Point any assistant or agent at **`ai.md`** (plain text: `https://raw.githubusercontent.com/ViktorHD/eurex-api/main/ai.md`; `ai.html` is the same content as a web page) and give it your API key. The page holds everything it needs to use the API: endpoint, authentication, datasets with their fields, filter / sort / paging syntax, recipes, error handling and rules. `llms.txt` is the short index for crawlers.

Example prompt: *Read https://raw.githubusercontent.com/ViktorHD/eurex-api/main/ai.md and use it to answer my questions with the Eurex API. My API key (header X-DBP-APIKEY): ...*

The app itself has no built-in chat and needs no AI keys.

## Run it

```bash
pip install -r requirements.txt
python app.py                      # http://localhost:8080
```

The app is static, so it also works from GitHub Pages; `app.py` only serves the same files. `DATABRICKS_APP_PORT` sets the port (default `8080`).

## Test

```bash
npm ci && npm test                          # front end (Jest)
pip install -r requirements-dev.txt && pytest   # server
```

## Layout

- `index.html`, `explorer/`: the front end (plain ES modules, no build step). `app.js` wires the views;
  each view and helper is its own module with tests in `explorer/tests/`.
- `app.py`: serves the front end and the AI instructions page.
- `ai.md`, `ai.html`, `llms.txt`: instructions for AI agents (keep `ai.md` and `ai.html` in sync; a test checks the key facts).
- `docs/api-data-proposals.md`: proposed new API queries from public Eurex information.
- `notebooks/`: tutorials and recipes for the API.
