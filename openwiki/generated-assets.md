# Generated assets

| File | Generator | Source |
|---|---|---|
| `ai/claude_tools.json`, `ai/openai_tools.json`, `ai/openapi.json` | `scripts/build_ai_assets.py` | `eurex_mcp/definitions.py` over the tool registry (`openapi.json` uses the placeholder server `https://YOUR-APP-HOST`) |
| `llms-full.txt` | `scripts/build_ai_assets.py` | `ai.md` + tool list + `schema.graphql` (if present) |
| `schema.graphql` | `scripts/export_schema.py` | live introspection via `eurex_mcp/sdl.py`; needs network and a key; **not committed yet** |

Commands:

```bash
python scripts/build_ai_assets.py          # write
python scripts/build_ai_assets.py --check  # exit 1 if stale (CI runs this)
EUREX_API_KEY=... python scripts/export_schema.py [--check]
```

Never hand-edit generated files. The weekly `refresh AI assets` workflow (Mondays 05:17 UTC) re-exports the schema, rebuilds assets, runs pytest and opens a PR on `bot/refresh-ai-assets`.

`ai.md` and `ai.html` are hand-written and must stay in sync (a test checks key facts); `llms.txt` is the short crawler index.
