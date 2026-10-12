import io
import json
import urllib.error

import pytest

from eurex_mcp import tools
from eurex_mcp.client import EurexClient, EurexError

from conftest import FakeEurex

HOURS = {'TradingHours': {'date': '2026-10-09', 'data': [{'Product': 'FESX', 'StartContinuousTrading': '08:00', 'EndContinuousTrading': '22:00',
                                                          'StartTES': '07:30', 'EndTES': '22:15'}]}}
HOLIDAYS = {'Holidays': {'date': '2026-10-09', 'data': [{'Product': 'FESX', 'Holiday': '2026-12-24', 'ExchangeHoliday': True},
                                                        {'Product': 'FESX', 'Holiday': '2020-01-01', 'ExchangeHoliday': True}]}}


def fake(*pairs):
    return FakeEurex(list(pairs))


class TestDispatch:
    def test_unknown_tool_and_arguments(self):
        c = fake()
        assert tools.call(c, 'nope')['kind'] == 'input'
        assert 'Unknown argument' in tools.call(c, 'get_holidays', {'product': 'FESX', 'colour': 'red'})['error']
        assert 'Missing argument' in tools.call(c, 'get_holidays', {})['error']
        assert 'must be integer' in tools.call(c, 'get_holidays', {'product': 'FESX', 'limit': 'x'})['error']
        assert tools.call(c, 'get_holidays', {'product': 'FESX', 'limit': True})['ok'] is False

    def test_product_code_cannot_inject_graphql(self):
        c = fake()
        r = tools.call(c, 'get_holidays', {'product': 'FESX") { x } #'})
        assert r['ok'] is False and r['kind'] == 'input' and c.sent == []

    def test_product_is_sent_as_variable_in_upper_case(self):
        c = fake(('Holidays', HOLIDAYS))
        tools.call(c, 'get_holidays', {'product': 'fesx'})
        assert c.sent[0][1] == {'p': 'FESX'} and 'FESX' not in c.sent[0][0]

    def test_null_arguments_are_ignored(self):
        c = fake(('Holidays', HOLIDAYS))
        assert tools.call(c, 'get_holidays', {'product': 'FESX', 'limit': None})['ok']

    def test_every_tool_has_a_valid_schema(self):
        for t in tools.TOOLS.values():
            assert t.schema['type'] == 'object' and t.schema['additionalProperties'] is False
            assert set(t.schema['required']) <= set(t.schema['properties'])
            assert t.description.endswith('.')
            for spec in t.schema['properties'].values():
                assert spec['type'] in ('string', 'integer', 'number', 'boolean', 'object') and spec['description']


class TestTools:
    def test_search_products(self):
        c = fake(('ProductInfos', {'ProductInfos': {'date': '2026-10-09', 'data': [
            {'Product': 'FESX', 'Name': 'Euro STOXX 50 Futures'}, {'Product': 'FDAX', 'Name': 'DAX Futures'}]}}))
        r = tools.call(c, 'search_products', {'query': 'stoxx'})
        assert r['ok'] and r['as_of'] == '2026-10-09' and [p['Product'] for p in r['products']] == ['FESX']
        assert 'hint' in tools.call(c, 'search_products', {'query': 'zzzz'})

    def test_market_status_and_holiday(self):
        c = fake(('TradingHours', {**HOURS, **HOLIDAYS}))
        r = tools.call(c, 'get_market_status', {'product': 'FESX', 'at': '2026-10-12T10:00:00'})
        assert r['status'] == 'open' and r['next_holiday'] == '2026-12-24' and r['as_of'] == '2026-10-09'
        assert tools.call(c, 'get_market_status', {'product': 'FESX', 'at': '2026-12-24T10:00:00'})['status'] == 'holiday'
        assert tools.call(c, 'get_market_status', {'product': 'FESX', 'at': 'later'})['kind'] == 'input'

    def test_market_status_unknown_product(self):
        c = fake(('TradingHours', {'TradingHours': {'date': 'd', 'data': []}, 'Holidays': {'date': 'd', 'data': []}}))
        r = tools.call(c, 'get_market_status', {'product': 'ZZZZ'})
        assert r['ok'] is False and 'search_products' in r['hint']

    def test_get_product_bundles_one_request(self):
        data = {'ProductInfos': {'date': '2026-10-09', 'data': [{'Product': 'FESX', 'Currency': 'EUR'}]},
                **HOURS, **HOLIDAYS,
                'TickRules': {'date': 'd', 'data': []}, 'TESProfiles': {'date': 'd', 'data': []},
                'Expirations': {'date': 'd', 'data': [{'ExpirationDate': '2000-01-01'}, {'ExpirationDate': '2999-01-01'}]}}
        c = fake(('ProductInfos', data))
        r = tools.call(c, 'get_product', {'product': 'FESX'})
        assert len(c.sent) == 1 and r['product']['Currency'] == 'EUR'
        assert [e['ExpirationDate'] for e in r['expirations']['upcoming']] == ['2999-01-01']
        assert r['holidays']['upcoming'] == [d for d in ['2026-12-24'] if d >= tools._today()]

    def test_get_product_unknown(self):
        empty = {k: {'date': 'd', 'data': []} for k in ('ProductInfos', 'TradingHours', 'TickRules', 'TESProfiles', 'Holidays', 'Expirations')}
        r = tools.call(fake(('ProductInfos', empty)), 'get_product', {'product': 'ZZZZ'})
        assert r['ok'] is False and 'No product' in r['error']

    def test_partial_errors_become_warnings(self):
        data = {'Holidays': HOLIDAYS['Holidays'], '_partial_errors': ['Expirations: boom']}
        r = tools.call(fake(('Holidays', data)), 'get_holidays', {'product': 'FESX'})
        assert r['ok'] and r['warnings'] == ['Expirations: boom']

    def test_tick_size_with_check(self):
        rows = [{'TradeType': 'ORDER_BOOK', 'InstrumentType': 'SIMPLE', 'StartPrice': 0, 'EndPrice': None, 'PriceStep': 1}]
        c = fake(('TickRules', {'TickRules': {'date': 'd', 'data': rows}}))
        r = tools.call(c, 'get_tick_size', {'product': 'FESX', 'price': 5000.25})
        assert r['check'] == {'price': 5000.25, 'step': 1.0, 'valid': False, 'below': 5000.0, 'above': 5001.0}

    def test_expirations_default_to_upcoming_sorted(self):
        rows = [{'ExpirationDate': '2999-02-01'}, {'ExpirationDate': '1999-01-01'}, {'ExpirationDate': '2999-01-01'}]
        r = tools.call(fake(('Expirations', {'Expirations': {'date': 'd', 'data': rows}})), 'get_expirations', {'product': 'OESX', 'limit': 1})
        assert [e['ExpirationDate'] for e in r['expirations']] == ['2999-01-01'] and r['total'] == 2

    def test_tes_thresholds_per_expiration(self):
        profiles = [{'TESType': 'TES', 'InstrumentType': 'S', 'MinExpiryRange': 1, 'MinLotSize': 50},
                    {'TESType': 'TES', 'InstrumentType': 'S', 'MinExpiryRange': 3, 'MinLotSize': 10}]
        exps = [{'ExpirationIndex': i, 'ExpirationDate': f'299{i}-01-01'} for i in (1, 2, 3)]
        c = fake(('TESProfiles', {'TESProfiles': {'date': 'd', 'data': profiles}, 'Expirations': {'date': 'd', 'data': exps}}))
        r = tools.call(c, 'get_tes_thresholds', {'product': 'OESX'})
        assert [x['MinLotSize'] for x in r['per_expiration']] == [50, 50, 10]
        bad = tools.call(c, 'get_tes_thresholds', {'product': 'OESX', 'tes_type': 'X'})
        assert bad['ok'] is False and 'Available groups' in bad['hint']

    def test_changes_filtering(self):
        rows = [{'Date': '2026-01-01', 'Description': 'FESX tick change', 'Query': 'TickRules'}, {'Date': '2026-02-01', 'Description': 'other', 'Query': 'Contracts'}]
        c = fake(('Changelog', {'Changelog': {'date': 'd', 'data': rows}}))
        r = tools.call(c, 'get_changes', {'mentions': 'fesx'})
        assert r['total_matching'] == 1
        assert [x['Date'] for x in tools.call(c, 'get_changes', {})['changes']] == ['2026-02-01', '2026-01-01']

    def test_schema_listing_and_type(self):
        t = lambda n, k='SCALAR', of=None: {'name': n, 'kind': k, 'ofType': of}
        listing = {'__schema': {'queryType': {'fields': [{'name': 'Holidays', 'description': 'd', 'args': [{'name': 'filter', 'type': t('HolidayFilter', 'INPUT_OBJECT')}],
                                                           'type': t(None, 'NON_NULL', t('HolidayResult', 'OBJECT'))}]}}}
        r = tools.call(fake(('__schema', listing)), 'get_schema')
        assert r['datasets'][0] == {'name': 'Holidays', 'description': 'd', 'returns': 'HolidayResult!', 'args': {'filter': 'HolidayFilter'}}
        none = tools.call(fake(('__type', {'__type': None})), 'get_schema', {'type_name': 'Nope'})
        assert none['ok'] is False
        assert tools.call(fake(), 'get_schema', {'type_name': 'a b'})['kind'] == 'input'


class TestPaging:
    def test_follows_cursor_until_done(self):
        pages = iter([{'Contracts': {'date': 'd', 'data': [{'Contract': 'a'}], 'pageInfo': {'hasNextPage': True, 'endCursor': 'c1'}}},
                      {'Contracts': {'date': 'd', 'data': [{'Contract': 'b'}], 'pageInfo': {'hasNextPage': False, 'endCursor': None}}}])

        class C(FakeEurex):
            def query(self, q, v=None, fresh=False):
                self.sent.append((q, v))
                return next(pages)
        c = C([])
        date, rows, truncated = tools.fetch_pages(c, 'Contracts', ['Contract'], 'OESX', page_size=1, max_rows=10)
        assert [r['Contract'] for r in rows] == ['a', 'b'] and not truncated
        assert 'after: "c1"' in c.sent[1][0] and 'after' not in c.sent[0][0]

    def test_truncates_at_max_rows(self):
        page = {'Contracts': {'date': 'd', 'data': [{'Contract': 'a'}, {'Contract': 'b'}], 'pageInfo': {'hasNextPage': True, 'endCursor': 'c'}}}
        _, rows, truncated = tools.fetch_pages(fake(('Contracts', page)), 'Contracts', ['Contract'], 'X', page_size=2, max_rows=2)
        assert len(rows) == 2 and truncated

    def test_sort_is_dropped_when_the_api_rejects_it(self):
        class C(FakeEurex):
            def query(self, q, v=None, fresh=False):
                self.sent.append((q, v))
                if 'sort:' in q:
                    raise EurexError('bad sort', kind='graphql')
                return {'SettlementPrices': {'date': 'd', 'data': [{'ContractID': '1', 'SettlementDate': '2026-01-01'}], 'pageInfo': {'hasNextPage': False}}}
        c = C([])
        r = tools.call(c, 'get_settlement_prices', {'product': 'FESX'})
        assert r['ok'] and len(r['prices']) == 1 and len(c.sent) == 2

    def test_contracts_filters_and_strikes(self):
        rows = [{'Contract': 'x', 'ContractDate': '2026-12', 'CallPut': 'C', 'Strike': 5000}, {'Contract': 'y', 'ContractDate': '2027-03', 'CallPut': 'P', 'Strike': 4000}]
        c = fake(('Contracts', {'Contracts': {'date': 'd', 'data': rows, 'pageInfo': {'hasNextPage': False}}}))
        assert tools.call(c, 'list_contracts', {'product': 'OESX', 'contract_date': '202612'})['total_matching'] == 1
        assert tools.call(c, 'list_contracts', {'product': 'OESX', 'call_put': 'put'})['contracts'][0]['Contract'] == 'y'
        assert tools.call(c, 'get_strikes', {'product': 'OESX'})['contract_dates']['2027-03']['puts'] == [4000]

    def test_settlement_filters_newest_first(self):
        rows = [{'ContractID': '1', 'SettlementDate': '2026-01-01'}, {'ContractID': '1', 'SettlementDate': '2026-03-01'}, {'ContractID': '2', 'SettlementDate': '2026-04-01'}]
        c = fake(('SettlementPrices', {'SettlementPrices': {'date': 'd', 'data': rows, 'pageInfo': {'hasNextPage': False}}}))
        r = tools.call(c, 'get_settlement_prices', {'product': 'FESX', 'contract_id': '1', 'limit': 5})
        assert [p['SettlementDate'] for p in r['prices']] == ['2026-03-01', '2026-01-01']


class TestRunGraphql:
    @pytest.mark.parametrize('q', ['{ Contracts { data { Contract } } }', '{ SettlementPrices(page: {first: 5}) { date } }',
                                   '{ FlexibleContracts(filter: {Contract: {eq: "x"}}) { date } }'])
    def test_unfiltered_big_datasets_are_refused(self, q):
        c = fake()
        r = tools.call(c, 'run_graphql', {'query': q})
        assert r['ok'] is False and 'Product' in r['error'] and c.sent == []

    def test_filtered_query_runs_and_mutations_are_refused(self):
        c = fake(('Contracts', {'Contracts': {'date': 'd', 'data': []}}))
        assert tools.call(c, 'run_graphql', {'query': '{ Contracts(filter: { Product: { eq: "FESX" } }) { date } }'})['ok']
        assert tools.call(c, 'run_graphql', {'query': 'mutation { x }'})['kind'] == 'input'

    def test_large_results_are_cut(self):
        big = {'Holidays': {'date': 'd', 'data': [{'Holiday': 'x' * 100}] * 50}}
        r = tools.call(fake(('Holidays', big)), 'run_graphql', {'query': '{ Holidays { date } }', 'max_chars': 500})
        assert r['truncated'] and len(r['partial_json']) == 500


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def http_error(code, retry_after=None):
    headers = {'Retry-After': retry_after} if retry_after else {}
    return urllib.error.HTTPError('u', code, 'm', headers, io.BytesIO(b'{}'))


class TestClient:
    def client(self, outcomes, **kw):
        calls, sleeps = [], []

        def opener(req, timeout=None):
            calls.append(req)
            out = outcomes.pop(0)
            if isinstance(out, Exception):
                raise out
            return FakeResponse(json.dumps(out).encode())

        c = EurexClient(api_key='k', endpoint='https://x/', opener=opener, sleep=sleeps.append, **kw)
        return c, calls, sleeps

    def test_sends_key_and_json(self):
        c, calls, _ = self.client([{'data': {'a': 1}}])
        assert c.query('{ a }', {'v': 1}) == {'a': 1}
        assert calls[0].get_header('X-dbp-apikey') == 'k' and json.loads(calls[0].data) == {'query': '{ a }', 'variables': {'v': 1}}

    def test_cache(self):
        c, calls, _ = self.client([{'data': {'a': 1}}])
        c.query('{ a }')
        c.query('{ a }')
        assert len(calls) == 1

    def test_retries_429_with_retry_after_then_gives_up(self):
        c, calls, sleeps = self.client([http_error(429, '3'), http_error(429), http_error(429)])
        with pytest.raises(EurexError) as e:
            c.query('{ a }')
        assert e.value.kind == 'rate_limit' and len(calls) == 3 and sleeps == [3.0, 2 ** 1]

    def test_recovers_after_503(self):
        c, _, sleeps = self.client([http_error(503), {'data': {'a': 1}}])
        assert c.query('{ a }') == {'a': 1} and len(sleeps) == 1

    def test_auth_error_is_not_retried(self):
        c, calls, _ = self.client([http_error(401)])
        with pytest.raises(EurexError) as e:
            c.query('{ a }')
        assert e.value.kind == 'auth' and len(calls) == 1

    def test_graphql_errors(self):
        c, _, _ = self.client([{'errors': [{'message': 'Cannot query field x', 'path': ['Foo']}]}, {'data': {'a': 1}, 'errors': [{'message': 'late', 'path': ['B']}]}])
        with pytest.raises(EurexError) as e:
            c.query('{ x }')
        assert e.value.kind == 'graphql' and 'Foo: Cannot query field x' in str(e.value)
        partial = c.query('{ y }')
        assert partial['a'] == 1 and partial['_partial_errors'] == ['B: late']

    def test_timeout_and_network(self):
        c, _, _ = self.client([TimeoutError()])
        with pytest.raises(EurexError) as e:
            c.query('{ a }')
        assert e.value.kind == 'timeout'
        c, _, _ = self.client([urllib.error.URLError('dns')])
        with pytest.raises(EurexError) as e:
            c.query('{ a }')
        assert e.value.kind == 'network'

    def test_demo_key_hint_on_429(self):
        c = EurexClient(opener=lambda *a, **k: (_ for _ in ()).throw(http_error(429)), sleep=lambda s: None, max_retries=0)
        assert c.using_demo_key
        with pytest.raises(EurexError) as e:
            c.query('{ a }')
        assert 'shared demo key' in e.value.hint
