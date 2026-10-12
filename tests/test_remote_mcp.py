import json

import pytest

import app as server
from eurex_mcp import remote, tools
from eurex_mcp.client import DEMO_KEY

H = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}


@pytest.fixture(autouse=True)
def reset_limits():
    remote._hits.clear()


@pytest.fixture
def client():
    return server.app.test_client()


def rpc(client, method, params=None, id_=1, headers=None, **kw):
    msg = {'jsonrpc': '2.0', 'method': method, **({'id': id_} if id_ is not None else {}), **({'params': params} if params else {})}
    return client.post('/mcp', data=json.dumps(msg), headers={**H, **(headers or {})}, **kw)


class FakeEurexClient:
    seen = []

    def __init__(self, api_key=None):
        FakeEurexClient.seen.append(api_key)
        self.endpoint, self.using_demo_key = 'e', api_key == DEMO_KEY

    def query(self, q, v=None, fresh=False):
        return {'Holidays': {'date': 'd', 'data': [{'Holiday': '2999-01-01'}]}}


@pytest.fixture
def fake(monkeypatch):
    FakeEurexClient.seen = []
    monkeypatch.setattr(remote, 'EurexClient', FakeEurexClient)
    return FakeEurexClient


class TestProtocol:
    def test_initialize_negotiates_version_and_gives_instructions(self, client):
        r = rpc(client, 'initialize', {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'x', 'version': '1'}}).get_json()
        assert r['result']['protocolVersion'] == '2025-03-26' and 'search_products' in r['result']['instructions']
        assert r['result']['capabilities'] == {'tools': {'listChanged': False}}
        newer = rpc(client, 'initialize', {'protocolVersion': '2099-01-01'}).get_json()
        assert newer['result']['protocolVersion'] == remote.SUPPORTED_VERSIONS[0]

    def test_tools_list_matches_the_registry(self, client):
        listed = rpc(client, 'tools/list').get_json()['result']['tools']
        assert {t['name'] for t in listed} == set(tools.TOOLS)
        assert all(t['inputSchema']['type'] == 'object' for t in listed)

    def test_notification_gets_202_and_ping_works(self, client):
        assert rpc(client, 'notifications/initialized', id_=None).status_code == 202
        assert rpc(client, 'ping').get_json()['result'] == {}

    def test_errors(self, client):
        assert rpc(client, 'resources/list').get_json()['error']['code'] == -32601
        assert rpc(client, 'tools/call', {'name': 'nope'}).get_json()['error']['code'] == -32602
        bad = client.post('/mcp', data='{oops', headers=H)
        assert bad.status_code == 400 and bad.get_json()['error']['code'] == -32700
        assert client.post('/mcp', data='{"hello": 1}', headers=H).get_json()['error']['code'] == -32600
        assert client.post('/mcp', data='[]', headers=H).status_code == 400

    def test_batch(self, client):
        body = [{'jsonrpc': '2.0', 'id': 1, 'method': 'ping'}, {'jsonrpc': '2.0', 'method': 'notifications/initialized'}, {'jsonrpc': '2.0', 'id': 2, 'method': 'ping'}]
        r = client.post('/mcp', data=json.dumps(body), headers=H).get_json()
        assert [x['id'] for x in r] == [1, 2]

    def test_get_is_not_allowed_and_cors_preflight_works(self, client):
        r = client.get('/mcp')
        assert r.status_code == 405 and r.headers['Allow'] == 'POST, OPTIONS'
        pre = client.options('/mcp')
        assert pre.status_code == 204 and 'X-DBP-APIKEY' in pre.headers['Access-Control-Allow-Headers']
        assert rpc(client, 'ping').headers['Access-Control-Allow-Origin'] == '*'


class TestCalls:
    def test_call_returns_text_content_with_the_json_result(self, client, fake):
        r = rpc(client, 'tools/call', {'name': 'get_holidays', 'arguments': {'product': 'FESX'}}).get_json()['result']
        body = json.loads(r['content'][0]['text'])
        assert r['isError'] is False and body['ok'] and body['holidays'][0]['Holiday'] == '2999-01-01'

    def test_tool_failures_are_results_not_protocol_errors(self, client, fake):
        r = rpc(client, 'tools/call', {'name': 'get_holidays', 'arguments': {'product': '???'}}).get_json()['result']
        assert r['isError'] is True and json.loads(r['content'][0]['text'])['kind'] == 'input'

    def test_key_from_header_or_bearer_else_demo(self, client, fake):
        call = {'name': 'get_holidays', 'arguments': {'product': 'FESX'}}
        rpc(client, 'tools/call', call, headers={'X-DBP-APIKEY': 'mine'})
        rpc(client, 'tools/call', call, headers={'Authorization': 'Bearer other'})
        rpc(client, 'tools/call', call)
        assert fake.seen == ['mine', 'other', DEMO_KEY]

    def test_demo_key_is_limited_per_address_but_own_keys_are_not(self, client, fake, monkeypatch):
        monkeypatch.setattr(remote, 'DEMO_CALLS_PER_MINUTE', 2)
        call = {'name': 'get_holidays', 'arguments': {'product': 'FESX'}}
        results = [rpc(client, 'tools/call', call, headers={'X-Forwarded-For': '1.1.1.1'}).get_json()['result'] for _ in range(3)]
        assert [r['isError'] for r in results] == [False, False, True]
        assert 'own free key' in json.loads(results[2]['content'][0]['text'])['hint']
        assert rpc(client, 'tools/call', call, headers={'X-Forwarded-For': '2.2.2.2'}).get_json()['result']['isError'] is False
        assert rpc(client, 'tools/call', call, headers={'X-Forwarded-For': '1.1.1.1', 'X-DBP-APIKEY': 'mine'}).get_json()['result']['isError'] is False
