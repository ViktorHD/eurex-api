import json
import os
import subprocess
import sys
import types

import pytest

import app as server
from eurex_mcp import definitions, rest, tools
from eurex_mcp.sdl import schema_to_sdl

ROOT = server.ROOT


@pytest.fixture
def client():
    return server.app.test_client()


class TestRest:
    def test_key_is_required_and_never_defaulted(self, client):
        r = client.post('/api/v1/tools/get_api_info', json={})
        assert r.status_code == 401 and r.get_json()['kind'] == 'auth'

    def test_unknown_tool_and_bad_body(self, client):
        h = {'X-DBP-APIKEY': 'k'}
        assert client.post('/api/v1/tools/nope', json={}, headers=h).status_code == 404
        assert client.post('/api/v1/tools/get_holidays', data='[1]', content_type='application/json', headers=h).status_code == 400
        assert client.post('/api/v1/tools/get_holidays', json={'product': '???'}, headers=h).status_code == 400

    def test_forwards_the_callers_key_and_returns_the_result(self, client, monkeypatch):
        seen = {}

        class C:
            def __init__(self, api_key=None):
                seen['key'] = api_key
                self.endpoint, self.using_demo_key = 'e', False

            def query(self, q, v=None, fresh=False):
                return {'Holidays': {'date': 'd', 'data': [{'Holiday': '2999-01-01'}]}}
        monkeypatch.setattr(rest, 'EurexClient', C)
        r = client.post('/api/v1/tools/get_holidays', json={'product': 'FESX'}, headers={'X-DBP-APIKEY': 'user-key'})
        assert r.status_code == 200 and r.get_json()['ok'] and seen['key'] == 'user-key'

    @pytest.mark.parametrize('kind,status', [('auth', 401), ('rate_limit', 429), ('server', 502), ('graphql', 502)])
    def test_upstream_failures_map_to_status(self, client, monkeypatch, kind, status):
        from eurex_mcp.client import EurexError

        class C:
            def __init__(self, api_key=None):
                pass

            def query(self, *a, **k):
                raise EurexError('x', kind=kind)
        monkeypatch.setattr(rest, 'EurexClient', C)
        r = client.post('/api/v1/tools/get_holidays', json={'product': 'FESX'}, headers={'X-DBP-APIKEY': 'k'})
        assert r.status_code == status and r.get_json()['ok'] is False

    def test_tool_list_and_openapi(self, client):
        assert {t['name'] for t in client.get('/api/v1/tools').get_json()['tools']} == set(tools.TOOLS)
        doc = client.get('/openapi.json').get_json()
        assert doc['openapi'].startswith('3.') and doc['servers'][0]['url'] == 'http://localhost'
        assert {p.rsplit('/', 1)[1] for p in doc['paths']} == set(tools.TOOLS)
        op = doc['paths']['/api/v1/tools/get_tick_size']['post']
        assert op['operationId'] == 'get_tick_size' and op['requestBody']['content']['application/json']['schema']['required'] == ['product']


class TestDefinitions:
    def test_claude_and_openai_shapes(self):
        claude = {t['name']: t for t in definitions.claude_tools()}
        openai = {t['function']['name']: t['function'] for t in definitions.openai_tools()}
        assert set(claude) == set(openai) == set(tools.TOOLS)
        for name in claude:
            assert claude[name]['input_schema'] == openai[name]['parameters']

    def test_operation_ids_are_valid_function_names(self):
        for name in tools.TOOLS:
            assert len(name) <= 64 and name.replace('_', '').isalnum()


class TestGeneratedFiles:
    def test_committed_assets_are_up_to_date(self):
        res = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'build_ai_assets.py'), '--check'], capture_output=True, text=True)
        assert res.returncode == 0, res.stderr

    @pytest.mark.parametrize('path,mime', [('/ai.md', 'text/markdown'), ('/llms-full.txt', 'text/plain'),
                                          ('/ai/claude_tools.json', 'application/json'), ('/ai/openai_tools.json', 'application/json')])
    def test_agent_files_are_served_as_text(self, client, path, mime):
        r = client.get(path)
        assert r.status_code == 200 and r.mimetype == mime

    def test_only_listed_agent_files_are_served(self, client):
        for path in ('/ai/../app.py', '/ai/openapi.json.bak', '/ai/x', '/ai/'):
            assert client.get(path).status_code == 404

    def test_schema_route_follows_the_file(self, client):
        exists = os.path.isfile(os.path.join(ROOT, 'schema.graphql'))
        assert client.get('/schema.graphql').status_code == (200 if exists else 404)

    def test_llms_full_contains_the_instructions_and_every_tool(self):
        text = open(os.path.join(ROOT, 'llms-full.txt'), encoding='utf-8').read()
        assert open(os.path.join(ROOT, 'ai.md'), encoding='utf-8').read().strip() in text
        for name in tools.TOOLS:
            assert f'`{name}(' in text

    def test_instructions_name_all_tools_and_patterns(self):
        md = open(os.path.join(ROOT, 'ai.md'), encoding='utf-8').read()
        html = open(os.path.join(ROOT, 'ai.html'), encoding='utf-8').read()
        for name in tools.TOOLS:
            if name != 'get_api_info':
                assert name in md and name in html, name
        for needle in ('Answer patterns', 'Next expiration', 'Tick size at a price', 'MinExpiryRange'):
            assert needle in md and needle in html, needle

    def test_llms_txt_links_the_new_files(self):
        text = open(os.path.join(ROOT, 'llms.txt'), encoding='utf-8').read()
        for needle in ('llms-full.txt', 'schema.graphql', 'eurex_mcp', '/ai)'):
            assert needle in text


class TestSdl:
    def test_prints_types_inputs_enums_and_skips_builtins(self):
        n = lambda name, kind='SCALAR', of=None: {'name': name, 'kind': kind, 'ofType': of}
        schema = {'queryType': {'name': 'Query'}, 'types': [
            {'kind': 'OBJECT', 'name': 'Query', 'description': None, 'fields': [
                {'name': 'Holidays', 'description': 'Holidays per product', 'args': [{'name': 'filter', 'type': n('HolidayFilter', 'INPUT_OBJECT'), 'defaultValue': None}],
                 'type': n(None, 'NON_NULL', n('HolidayResult', 'OBJECT'))}]},
            {'kind': 'INPUT_OBJECT', 'name': 'HolidayFilter', 'inputFields': [{'name': 'Product', 'type': n('StringFilter', 'INPUT_OBJECT')}]},
            {'kind': 'ENUM', 'name': 'Order', 'enumValues': [{'name': 'ASC'}, {'name': 'DESC'}]},
            {'kind': 'SCALAR', 'name': 'String'}, {'kind': 'OBJECT', 'name': '__Type', 'fields': []}]}
        sdl = schema_to_sdl(schema)
        assert 'type Query {' in sdl and '  Holidays(filter: HolidayFilter): HolidayResult!' in sdl
        assert '"""Holidays per product"""' in sdl and 'input HolidayFilter {' in sdl and 'enum Order {\n  ASC\n  DESC\n}' in sdl
        assert 'scalar String' not in sdl and '__Type' not in sdl
        assert sdl.index('type Query') < sdl.index('enum Order')
