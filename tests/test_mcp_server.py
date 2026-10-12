import asyncio
import json

import pytest

pytest.importorskip('mcp')
pytest.importorskip('pydantic')

from eurex_mcp import tools  # noqa: E402
from eurex_mcp.server import build_server  # noqa: E402

from conftest import FakeEurex  # noqa: E402


def run(coro):
    return asyncio.run(coro)


def schema_of(t):
    return getattr(t, 'input_schema', None) or t.inputSchema


def server(responses=()):
    return build_server(FakeEurex(list(responses)))


def test_every_registry_tool_is_served_with_the_same_arguments():
    listed = {t.name: t for t in run(server().list_tools())}
    assert set(listed) == set(tools.TOOLS)
    for name, spec in tools.TOOLS.items():
        sch = schema_of(listed[name])
        assert set(sch['properties']) == set(spec.schema['properties']), name
        assert set(sch.get('required', [])) == set(spec.schema['required']), name
        assert listed[name].description == spec.description


def test_calling_a_tool_returns_the_json_result():
    s = server([('Holidays', {'Holidays': {'date': '2026-10-09', 'data': [{'Holiday': '2999-01-01'}]}})])
    out = run(s.call_tool('get_holidays', {'product': 'FESX'}))
    text = ''.join(getattr(b, 'text', '') for b in out.content) if hasattr(out, 'content') else str(out)
    body = json.loads(text)
    assert body['ok'] and body['holidays'][0]['Holiday'] == '2999-01-01'


def test_failures_are_results_with_a_hint_not_protocol_errors():
    s = server()
    out = run(s.call_tool('get_holidays', {'product': '???'}))
    text = ''.join(getattr(b, 'text', '') for b in out.content) if hasattr(out, 'content') else str(out)
    body = json.loads(text)
    assert body['ok'] is False and body['kind'] == 'input'


def test_prompt_and_resource_exist():
    s = server()
    assert any(p.name == 'eurex_question' for p in run(s.list_prompts()))
    assert any(str(r.uri) == 'eurex://rules' for r in run(s.list_resources()))
