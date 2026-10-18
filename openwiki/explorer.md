# Explorer front end

Plain ES modules, no bundler, no framework. `index.html` loads `explorer/app.js`, which wires the views. Imports carry cache-busting query strings (`./ui.js?v=8`); bump them when a module changes in a way browsers must refetch.

## Views (see root README for user terms)

API Overview, Products, Product card, Strike Window, Trading Hours, Calendar, API Explorer, Info.

## Modules

| Area | Modules |
|---|---|
| Wiring and API | `app.js` (entry, 1.3k lines, DOM lookups and event wiring), `client.js` (`GraphQLRequestError`, error kinds incl. `aborted`), `catalog.js` (one `ProductInfos` request for the page lifetime), `share.js` (state as base64 URL param) |
| Query editor | `editor.js` (highlight overlay, history, saved queries), `autocomplete.js`, `schemacheck.js` (schema index, validation, `completionsAt`), `schema.js` (docs pane), `examples.js` (`DOMAIN_QUERIES`), `pagination.js` (rewrites `page: {after}`), `tabs.js` (tabs, snapshot in localStorage), `changelog-query.js` |
| Results and export | `ui.js` (tables, search, filters, column chooser, CSV/Markdown/Excel), `xlsx.js` (dependency-free writer, stored ZIP), `displayformat.js` (display only; sorting/search/export use raw values), `linechart.js` (SVG) |
| Product data rules | `tradingstatus.js`, `ticks.js`, `tes.js`, `settlement.js`, `productquery.js` (builds the card request from the schema, omitting roots/fields the schema lacks), `products.js` (search ranking) |
| Views | `productcard.js`, `productsview.js`, `overview.js` (Strike Window, largest file), `timeline.js` (Trading Hours), `calendar.js` + `calendarview.js`, `info.js` (freshness and changelog), `ics.js` |
| Small helpers | `dom.js`, `watchlist.js`, `secretinput.js` |

## Rules

- Personal state (watchlist, tabs, history, saved queries, display settings) lives only in `localStorage`.
- Eurex time is Europe/Berlin everywhere; do not use the browser time zone for market logic.
- `secretinput.js` masks the key with CSS rather than `type=password` to avoid browser password-save prompts.
- `tradingstatus.js`, `ticks.js`, `tes.js` have Python ports in `eurex_mcp/logic.py`; change both together.
- Focus styles: a global `:focus-visible` outline in `styles.css` (see `.Jules/palette.md`).
