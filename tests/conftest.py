import json


class FakeEurex:
    """Stands in for EurexClient: answers by looking for a marker in the query text."""

    endpoint = 'https://example.invalid/graphql'
    using_demo_key = False

    def __init__(self, responses):
        self.responses = responses  # list of (marker, data dict or Exception)
        self.sent = []

    def query(self, query, variables=None, fresh=False):
        self.sent.append((query, variables))
        for marker, data in self.responses:
            if marker in query:
                if isinstance(data, Exception):
                    raise data
                return json.loads(json.dumps(data))
        raise AssertionError(f'unexpected query: {query[:200]}')
