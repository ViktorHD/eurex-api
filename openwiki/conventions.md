# Conventions and gotchas

- **One registry.** Do not describe a tool anywhere except `tools.py`; regenerate assets instead of editing them.
- **Tools never raise to callers.** Handlers raise `EurexError`; `tools.call` converts it to `ok=false` with `kind` and `hint`. Keep hints actionable.
- **Answers state provenance.** Include `as_of`; never fill gaps from memory (see `INSTRUCTIONS`).
- **Filters are mandatory** on `Contracts`, `FlexibleContracts`, `SettlementPrices`; use paging for large sets.
- **Explorer/Python parity.** Trading status, tick, TES logic exist in JS and Python; update both and their tests.
- **No secrets in the server.** The REST and hosted endpoints forward the caller's key per request and never store it. The demo key is public by design.
- **Static serving allowlist.** New public files need an entry in `app.py` (`AGENT_FILES`, or an allowed extension under `explorer/`).
- **No build step** for the front end; keep dependencies at zero (xlsx and charts are hand-written).
- **Docs sync.** Changing `ai.md` means updating `ai.html` and rerunning `build_ai_assets.py`.
- Other docs: `docs/api-data-proposals.md` (proposed new API queries), `notebooks/` (tutorials).
