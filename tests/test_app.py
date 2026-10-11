import re

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

    def test_page_offers_the_demo_key_the_explorer_uses(self, client):
        index = client.get('/').get_data(as_text=True)
        key = re.search(r'id="apiKey" value="([0-9a-f-]{36})"', index).group(1)
        text = client.get('/ai.html').get_data(as_text=True)
        assert key in text
        assert 'developer.deutsche-boerse.com' in text  # where to get an own free key

    def test_landing_page_links_to_the_instructions(self, client):
        assert 'href="ai.html"' in client.get('/').get_data(as_text=True)

    def test_llms_txt_points_to_the_page(self, client):
        resp = client.get('/llms.txt')
        assert resp.status_code == 200
        assert resp.mimetype == 'text/plain'
        assert '(ai.html)' in resp.get_data(as_text=True)


class TestAiInstructionsPlainText:
    """ai.md is what assistants are pointed at (some cannot read github.io); it must say the same as ai.html."""

    @staticmethod
    def md():
        with open(server.os.path.join(server.ROOT, 'ai.md'), encoding='utf-8') as f:
            return f.read()

    def test_same_key_facts_as_the_html_page(self, client):
        html = client.get('/ai.html').get_data(as_text=True)
        md = self.md()
        facts = ['api.developer.deutsche-boerse.com/eurex-prod-graphql', 'X-DBP-APIKEY', '68cdafd2-c5c1-49be-8558-37244ab4f513',
                 'console.developer.deutsche-boerse.com', '__schema']
        facts += ['ProductInfos', 'Contracts', 'FlexibleContracts', 'Expirations', 'TradingHours', 'Holidays', 'TickRules',
                  'TESProfiles', 'SettlementPrices', 'VendorCodes', 'DeliverableBonds', 'Enlight', 'EnlightResponders', 'Changelog']
        for fact in facts:
            assert fact in html and fact in md, fact

    def test_prompts_point_at_the_plain_text_file(self, client):
        raw = 'https://raw.githubusercontent.com/ViktorHD/eurex-api/main/ai.md'
        assert raw in self.md()
        assert raw in client.get('/ai.html').get_data(as_text=True)
        assert raw in client.get('/llms.txt').get_data(as_text=True)
