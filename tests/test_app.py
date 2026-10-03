import app as server
import pytest
import requests


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    server._hits.clear()
    monkeypatch.setenv('DATABRICKS_TOKEN', 'secret-token')
    monkeypatch.setattr(server, 'RATE_LIMIT_PER_MINUTE', 20)
    monkeypatch.setattr(server, 'GLOBAL_LIMIT_PER_MINUTE', 120)
    monkeypatch.delenv('ALLOWED_ORIGINS', raising=False)


@pytest.fixture
def client():
    return server.app.test_client()


MESSAGES = [{'role': 'user', 'content': 'hello'}]
SAME_ORIGIN = {'Origin': 'http://localhost'}  # the test client's host


class FakeResponse:
    def __init__(self, status=200, body=None, text=''):
        self.status_code = status
        self._body = body
        self.text = text or str(body)

    def json(self):
        if self._body is None:
            raise ValueError('no json')
        return self._body


def post(client, body=None, headers=SAME_ORIGIN, **kwargs):
    return client.post('/api/databricks', json={'messages': MESSAGES} if body is None else body, headers=headers, **kwargs)


# ---------- Static files ----------

class TestStaticFiles:
    def test_index_and_explorer_assets_are_served(self, client):
        assert client.get('/').status_code == 200
        assert client.get('/explorer/app.js').status_code == 200
        assert client.get('/explorer/styles.css').status_code == 200

    @pytest.mark.parametrize('path', [
        '/app.py', '/app.yaml', '/package.json', '/requirements.txt', '/notebooks/FAQ_cases.ipynb',
        '/.git/config', '/.Jules/palette.md', '/explorer/tests/ui.test.js', '/explorer/server.js',
        '/eurex-api/app.py', '/static/app.py', '/explorer/../app.py', '/explorer/.hidden.js', '/explorer/x.py',
    ])
    def test_repository_files_are_not_served(self, client, path):
        assert client.get(path).status_code == 404

    def test_status_does_not_reveal_secrets(self, client):
        body = client.get('/api/status').get_json()
        assert body == {'status': 'Flask is running'}


# ---------- Agent proxy ----------

class TestProxy:
    def test_forwards_messages_and_tools_with_the_server_token(self, client, monkeypatch):
        calls = []

        def fake_post(url, json, headers, timeout):
            calls.append((url, json, headers, timeout))
            return FakeResponse(200, {'choices': [{'message': {'content': 'hi'}}]})

        monkeypatch.setattr(server.requests, 'post', fake_post)
        tools = [{'type': 'function', 'function': {'name': 'eurex_graphql'}}]
        resp = post(client, {'messages': MESSAGES, 'tools': tools})

        assert resp.status_code == 200
        assert resp.get_json()['choices'][0]['message']['content'] == 'hi'
        url, payload, headers, timeout = calls[0]
        assert payload == {'messages': MESSAGES, 'tools': tools}
        assert headers['Authorization'] == 'Bearer secret-token'
        assert timeout == server.UPSTREAM_TIMEOUT_SECONDS

    def test_tries_the_next_payload_format_when_one_is_rejected(self, client, monkeypatch):
        seen = []

        def fake_post(url, json, headers, timeout):
            seen.append(json)
            return FakeResponse(422, text='bad format') if len(seen) == 1 else FakeResponse(200, {'predictions': ['ok']})

        monkeypatch.setattr(server.requests, 'post', fake_post)
        resp = post(client)
        assert resp.status_code == 200
        assert 'dataframe_records' in seen[1]

    def test_upstream_details_do_not_reach_the_browser(self, client, monkeypatch):
        monkeypatch.setattr(server.requests, 'post', lambda *a, **k: FakeResponse(400, text='internal stack trace https://dbc-secret'))
        resp = post(client)
        assert resp.status_code == 400
        assert 'dbc-secret' not in resp.get_data(as_text=True)
        assert 'stack trace' not in resp.get_data(as_text=True)

    def test_unreachable_upstream_is_a_502(self, client, monkeypatch):
        def boom(*a, **k):
            raise requests.ConnectionError('dns failure for dbc-secret')
        monkeypatch.setattr(server.requests, 'post', boom)
        resp = post(client)
        assert resp.status_code == 502
        assert 'dbc-secret' not in resp.get_data(as_text=True)

    def test_non_json_upstream_answer(self, client, monkeypatch):
        monkeypatch.setattr(server.requests, 'post', lambda *a, **k: FakeResponse(200, None, text='<html>'))
        assert post(client).status_code == 502

    def test_missing_token_is_reported_instead_of_calling_upstream(self, client, monkeypatch):
        monkeypatch.delenv('DATABRICKS_TOKEN')
        monkeypatch.setattr(server.requests, 'post', lambda *a, **k: pytest.fail('upstream must not be called'))
        assert post(client).status_code == 503


class TestProxyProtection:
    @pytest.fixture(autouse=True)
    def upstream(self, monkeypatch):
        monkeypatch.setattr(server.requests, 'post', lambda *a, **k: FakeResponse(200, {'ok': True}))

    def test_rejects_other_origins(self, client):
        assert post(client, headers={'Origin': 'https://evil.example'}).status_code == 403

    def test_rejects_requests_without_browser_origin_information(self, client):
        assert post(client, headers={}).status_code == 403

    def test_accepts_same_origin_fetch_metadata(self, client):
        assert post(client, headers={'Sec-Fetch-Site': 'same-origin'}).status_code == 200

    def test_accepts_the_forwarded_public_host(self, client):
        headers = {'Origin': 'https://eurex-api.example.com', 'X-Forwarded-Host': 'eurex-api.example.com'}
        assert post(client, headers=headers).status_code == 200

    def test_accepts_configured_origins(self, client, monkeypatch):
        monkeypatch.setenv('ALLOWED_ORIGINS', 'app.example.com')
        assert post(client, headers={'Origin': 'https://app.example.com'}).status_code == 200

    def test_rate_limits_per_client_and_sets_retry_after(self, client, monkeypatch):
        monkeypatch.setattr(server, 'RATE_LIMIT_PER_MINUTE', 3)
        headers = {**SAME_ORIGIN, 'X-Forwarded-For': '10.0.0.1'}
        assert [post(client, headers=headers).status_code for _ in range(3)] == [200, 200, 200]
        blocked = post(client, headers=headers)
        assert blocked.status_code == 429
        assert int(blocked.headers['Retry-After']) >= 1
        # another client is unaffected
        assert post(client, headers={**SAME_ORIGIN, 'X-Forwarded-For': '10.0.0.2'}).status_code == 200

    def test_global_limit_caps_total_use(self, client, monkeypatch):
        monkeypatch.setattr(server, 'GLOBAL_LIMIT_PER_MINUTE', 2)
        statuses = [post(client, headers={**SAME_ORIGIN, 'X-Forwarded-For': f'10.0.1.{i}'}).status_code for i in range(3)]
        assert statuses == [200, 200, 429]

    def test_spoofed_leading_forwarded_for_entries_do_not_bypass_the_limit(self, client, monkeypatch):
        monkeypatch.setattr(server, 'RATE_LIMIT_PER_MINUTE', 1)
        codes = [post(client, headers={**SAME_ORIGIN, 'X-Forwarded-For': f'{fake}, 10.9.9.9'}).status_code for fake in ('1.1.1.1', '2.2.2.2')]
        assert codes == [200, 429]

    def test_window_expires(self):
        key = 'k'
        assert server.rate_limited(key, now=0) == 0
        server.RATE_LIMIT_PER_MINUTE, original = 1, server.RATE_LIMIT_PER_MINUTE
        try:
            assert server.rate_limited(key, now=1) > 0
            assert server.rate_limited(key, now=61) == 0
        finally:
            server.RATE_LIMIT_PER_MINUTE = original

    @pytest.mark.parametrize('body', [
        [], {}, {'messages': []}, {'messages': 'hi'},
        {'messages': [{'role': 'root', 'content': 'x'}]},
        {'messages': [{'content': 'x'}]},
        {'messages': [{'role': 'user', 'content': {'a': 1}}]},
        {'messages': MESSAGES, 'tools': 'rm -rf'},
        {'messages': MESSAGES, 'tools': [{}] * 6},
        {'messages': MESSAGES * 81},
    ])
    def test_rejects_malformed_bodies(self, client, body):
        assert post(client, body).status_code == 400

    def test_accepts_tool_messages_and_assistant_tool_calls(self, client):
        messages = [
            {'role': 'user', 'content': 'q'},
            {'role': 'assistant', 'content': None, 'tool_calls': [{'id': '1', 'function': {'name': 'eurex_graphql', 'arguments': '{}'}}]},
            {'role': 'tool', 'tool_call_id': '1', 'name': 'eurex_graphql', 'content': '[]'},
        ]
        assert post(client, {'messages': messages}).status_code == 200

    def test_rejects_oversized_bodies(self, client):
        big = {'messages': [{'role': 'user', 'content': 'x' * (server.app.config['MAX_CONTENT_LENGTH'] + 1)}]}
        assert post(client, big).status_code == 413

    def test_security_headers(self, client):
        resp = client.get('/api/status')
        assert resp.headers['X-Content-Type-Options'] == 'nosniff'
        assert resp.headers['Cache-Control'] == 'no-store'
