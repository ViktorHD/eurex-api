import json
import os
import sys
from types import SimpleNamespace as NS

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'evals'))
import run_evals as ev  # noqa: E402

from eurex_mcp import tools  # noqa: E402

from conftest import FakeEurex  # noqa: E402


class TestQuestionFile:
    cases = ev.load_cases()

    def test_enough_unique_cases(self):
        ids = [c['id'] for c in self.cases]
        assert 30 <= len(ids) <= 50 and len(set(ids)) == len(ids)

    def test_expectations_refer_to_real_tools_and_datasets(self):
        datasets = {'ProductInfos', 'Contracts', 'Expirations', 'TradingHours', 'Holidays', 'TickRules', 'TESProfiles', 'SettlementPrices', 'Changelog'}
        for c in self.cases:
            e = c['expect']
            assert set(e.get('tools_any', [])) <= set(tools.TOOLS), c['id']
            assert set(e.get('datasets_all', [])) <= datasets, c['id']
            assert set(e) <= {'tools_any', 'datasets_all', 'contains_any', 'answer_cites'}, c['id']
            assert e, c['id']

    def test_load_only(self):
        assert [c['id'] for c in ev.load_cases(only=['exp-next'])] == ['exp-next']


class TestScore:
    def call(self, name='get_expirations', result=None, error=False, query=''):
        return {'name': name, 'input': {'query': query}, 'result': result or {}, 'error': error}

    def test_cites_live_values_from_tool_results(self):
        case = {'expect': {'tools_any': ['get_expirations'], 'answer_cites': ['ExpirationDate']}}
        calls = [self.call(result={'ok': True, 'expirations': [{'ExpirationDate': '2026-12-18'}]})]
        assert ev.score(case, 'The next expiry is 2026-12-18.', calls, 'tools')[0]
        ok, why = ev.score(case, 'It is in December.', calls, 'tools')
        assert not ok and 'cites none' in why[0]

    def test_wrong_tool_empty_answer_and_error_budget(self):
        case = {'expect': {'tools_any': ['get_tick_size']}}
        assert 'none of the tools' in ev.score(case, 'x', [self.call()], 'tools')[1][0]
        assert 'no answer' in ev.score({'expect': {}}, ' ', [], 'tools')[1]
        calls = [self.call(error=True) for _ in range(3)]
        assert '3 tool calls failed' in ev.score({'expect': {}}, 'x', calls, 'tools')[1]

    def test_docs_mode_checks_the_queries_sent(self):
        case = {'expect': {'datasets_all': ['Expirations'], 'tools_any': ['ignored in docs mode']}}
        assert ev.score(case, 'x', [self.call(name='graphql_request', query='{ Expirations { date } }')], 'docs')[0]
        assert not ev.score(case, 'x', [self.call(name='graphql_request', query='{ Holidays { date } }')], 'docs')[0]

    def test_collect_values_walks_nested_json(self):
        assert ev.collect_values({'a': [{'K': 1}, {'x': {'K': 'v'}}], 'K': True}, {'K'}) == {'1', 'v'}


class FakeApi:
    """Scripted Messages API: first asks for a tool, then answers."""

    def __init__(self, script):
        self.script = list(script)
        self.messages = NS(create=self.create)
        self.requests = []

    def create(self, **kw):
        self.requests.append(kw)
        return self.script.pop(0)


def msg(stop, *blocks):
    return NS(stop_reason=stop, content=list(blocks), usage=NS(input_tokens=10, output_tokens=5))


def test_run_case_executes_tools_and_returns_the_answer():
    eurex = FakeEurex([('Holidays', {'Holidays': {'date': 'd', 'data': [{'Holiday': '2999-01-01'}]}})])
    api = FakeApi([
        msg('tool_use', NS(type='tool_use', id='t1', name='get_holidays', input={'product': 'FESX'})),
        msg('end_turn', NS(type='text', text='Next holiday: 2999-01-01'))])
    case = {'id': 'x', 'question': 'next holiday?', 'expect': {'tools_any': ['get_holidays'], 'answer_cites': ['Holiday']}}
    answer, calls, usage = ev.run_case(api, eurex, case, 'tools', 'm')
    assert answer == 'Next holiday: 2999-01-01' and usage == {'input': 20, 'output': 10}
    assert ev.score(case, answer, calls, 'tools')[0]
    sent = api.requests[1]['messages'][2]['content'][0]
    assert sent['tool_use_id'] == 't1' and sent['is_error'] is False and '2999-01-01' in sent['content']
    assert {t['name'] for t in api.requests[0]['tools']} == set(tools.TOOLS)


def test_docs_mode_gives_one_raw_graphql_tool_and_the_docs():
    eurex = FakeEurex([('Holidays', {'Holidays': {'date': 'd', 'data': []}})])
    api = FakeApi([msg('tool_use', NS(type='tool_use', id='t', name='graphql_request', input={'query': '{ Holidays { date } }'})),
                   msg('end_turn', NS(type='text', text='none'))])
    _, calls, _ = ev.run_case(api, eurex, {'question': 'q'}, 'docs', 'm', system_docs='DOCS')
    assert [t['name'] for t in api.requests[0]['tools']] == ['graphql_request'] and api.requests[0]['system'] == 'DOCS'
    assert calls[0]['result'] == {'data': {'Holidays': {'date': 'd', 'data': []}}}


def test_summary():
    s = ev.summarize([{'passed': True, 'calls': [1, 2], 'tool_errors': 0, 'usage': {'input': 1, 'output': 2}},
                      {'passed': False, 'calls': [], 'tool_errors': 1, 'usage': {'input': 3, 'output': 4}}])
    assert s == {'cases': 2, 'passed': 1, 'pass_rate': 0.5, 'tool_calls_per_case': 1.0, 'tool_errors': 1, 'input_tokens': 4, 'output_tokens': 6}
