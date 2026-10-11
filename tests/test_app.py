import app as server
import pytest


@pytest.fixture
def client():
    return server.app.test_client()


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

    def test_removed_assistant_endpoints_are_gone(self, client):
        assert client.post('/api/llm', json={'messages': []}).status_code == 404
        assert client.post('/api/databricks', json={'messages': []}).status_code == 404

    def test_status(self, client):
        assert client.get('/api/status').get_json() == {'status': 'Flask is running'}

    def test_security_headers(self, client):
        resp = client.get('/api/status')
        assert resp.headers['X-Content-Type-Options'] == 'nosniff'
        assert resp.headers['Cache-Control'] == 'no-store'


class TestAiInstructions:
    def test_page_is_served_with_the_essentials(self, client):
        resp = client.get('/ai.html')
        assert resp.status_code == 200
        text = resp.get_data(as_text=True)
        for needle in ('api.developer.deutsche-boerse.com/eurex-prod-graphql', 'X-DBP-APIKEY', 'ProductInfos', '__schema'):
            assert needle in text

    def test_page_holds_no_api_key(self, client):
        assert '68cdafd2' not in client.get('/ai.html').get_data(as_text=True)

    def test_llms_txt_points_to_the_page(self, client):
        resp = client.get('/llms.txt')
        assert resp.status_code == 200
        assert resp.mimetype == 'text/plain'
        assert '(ai.html)' in resp.get_data(as_text=True)
