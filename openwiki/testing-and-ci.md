# Testing and CI

## Commands

```bash
pip install -r requirements-dev.txt && pytest   # pytest.ini: pythonpath ., testpaths tests
npm ci && npm test                              # Jest 29 + jsdom, ESM via --experimental-vm-modules
python scripts/build_ai_assets.py --check       # generated files up to date
```

## Python (`tests/`)

| File | Covers |
|---|---|
| `test_mcp_logic.py` | `logic.py` rules |
| `test_mcp_tools.py` | each tool against `FakeEurex` |
| `test_mcp_server.py` | MCP server construction and tool wrappers |
| `test_remote_mcp.py` | `/mcp` JSON-RPC, batching, limits, demo-key limiter |
| `test_rest_and_assets.py` | REST wrapper, tool definitions, generated assets up to date, SDL, `ai.md`/`ai.html` key facts, agent-file routes |
| `test_app.py` | Static allowlist (repo files not served), status, security headers |
| `test_evals.py` | eval harness (no model calls) |

`conftest.py` provides `FakeEurex`: a stand-in client that answers by finding a marker substring in the query text and raises if no marker matches. Tests never hit the network.

## Front end (`explorer/tests/*.test.js`)

One test file per module family (calendar, client, editor, ticks, tes, settlement, tabs and tabs a11y, ui and `ui_xss`, xlsx, schemacheck, ...). `ui_xss.test.js` guards escaping in rendered tables.

## Workflows (`.github/workflows/`)

- `tests.yml`: on push to `main` and PRs; Python 3.12 pytest + asset check; Node 22 Jest.
- `ai-assets.yml`: weekly schema refresh PR (see [Generated assets](generated-assets.md)).
- `evals.yml`: manual; runs `evals/run_evals.py` in `tools` and `docs` modes (needs `ANTHROPIC_API_KEY`, `EUREX_API_KEY`).

## Evals

`evals/questions.json` holds the question set with live-data checks (`tools_any`, `datasets_all`, `contains_any`, `answer_cites`). `run_evals.py --mode tools|docs [--only ids] [--out file]` reports pass rate, tool calls, errors and tokens. Use it to measure changes to `ai.md` or tool descriptions.
