# Eurex API Explorer

## Project Overview
A browser-based GraphQL client for the Deutsche Börse Eurex Reference Data API. Users enter their API key, write GraphQL queries, and see results in an interactive table. Includes schema introspection, autocomplete, multi-tab queries, and CSV/MD export.

## Tech Stack
- **Frontend:** Vanilla JS (no framework), HTML, CSS
- **API:** Deutsche Börse Eurex GraphQL endpoint (`https://api.developer.deutsche-boerse.com/eurex-prod-graphql/`)
- **Auth:** API key via `X-DBP-APIKEY` header
- **Icons:** Feather Icons (loaded from CDN)
- **Fonts:** Inter (Google Fonts)
- **Tests:** Jest (unit tests for utility functions)

## File Structure
```
├── index.html       # Main HTML — three-pane layout (editor, results, docs)
├── app.js           # All application logic (DOM, fetch, schema, autocomplete, tabs)
├── styles.css       # Full stylesheet with CSS custom properties
├── app.test.js      # Jest unit tests for getTypeName()
├── benchmark.js     # Performance benchmark for table filtering
├── package.json     # Dependencies (jest only)
└── plan.md          # Design improvement plan (Material Design direction)
```

## Architecture Notes
- **Single-file JS:** All logic lives in `app.js` inside a DOMContentLoaded listener, with `getTypeName` exported for testing.
- **Three-pane layout:** Query editor (left, dark), Results table (center), Schema docs (right, toggleable). All panes are resizable via drag handles.
- **Tab system:** Multiple query tabs with independent state (query text, result data, sort, filters).
- **Schema introspection:** Fetches `__schema` via introspection query, renders collapsible type explorer with search, generates queries from type definitions.
- **Autocomplete:** Custom dropdown in the query editor, built from introspection data.
- **Data display:** Flattens nested GraphQL responses to find the first array, renders as a sortable/filterable HTML table.

## Design System (Current — Eurex Branding)
- **Colors:** `--navy-blue: #201751`, `--neon-green: #00ce7d`, light grays
- **Typography:** Inter 400/500/600
- **Aesthetic:** Material Design-influenced with Eurex branding colors
- **Elevation:** Two-level box shadows (`--elevation-1`, `--elevation-2`)

## Known Issues & Improvement Areas

### UI/UX
- Loading state uses a bare spinner — should be skeleton screens
- Error display is a simple red box — needs friendly messages, retry button, collapsible technical details
- Empty state is minimal italic text — needs illustration or icon and helpful guidance
- Table doesn't format dates, numbers, or IDs for non-technical users
- No transition animations between states (loading → data)
- The query editor textarea lacks line numbers, syntax highlighting
- Mobile responsiveness is basic (only hides nav below 700px)

### Data Layer
- No caching — every query re-fetches
- No request deduplication
- No error normalization (raw error strings shown)
- GraphQL errors and network errors treated the same way
- `flattenGraphQLResponse` is fragile — just finds first array

### Code Quality
- Monolithic `app.js` (~700 lines) — should be modularized
- No TypeScript, no type safety
- Only one exported/tested function (`getTypeName`)
- DOM manipulation is all imperative — no component abstraction

## Full Overhaul Goals (from plan.md + skill guidance)

### Phase 1: Design System Refresh
- Update CSS variables for better Material Design alignment
- Replace bare spinners with skeleton loading screens
- Add friendly error cards with retry buttons
- Improve empty states with icons and CTAs
- Add fade-in/stagger animations for data load
- Better table styling: hover rows, formatted cells, responsive card layout on mobile

### Phase 2: Data Layer Improvements
- Extract a proper GraphQL client module with:
  - Configurable endpoint + headers
  - In-memory cache with TTL
  - Error normalization (network vs GraphQL errors, human-friendly messages)
  - Request deduplication for identical in-flight queries
- Add formatters for dates (relative/locale), numbers, and status badges

### Phase 3: Code Structure
- Split `app.js` into modules (client, ui, schema, tabs, autocomplete)
- Add proper state management
- Expand test coverage

## Commands
- `npm test` — Run Jest tests
- `node benchmark.js` — Run filter performance benchmark

## Conventions
- Use CSS custom properties for all colors, spacing, and shadows
- Keep the app framework-free (vanilla JS)
- Preserve Eurex branding colors (`--navy-blue`, `--neon-green`)
- All user-facing text should be non-technical and friendly
- Prefer `const` over `let`, never use `var`
