#!/usr/bin/env python3
"""Measure how well a model answers Eurex questions, with the tools or with the docs only.

    pip install -r requirements-evals.txt
    export ANTHROPIC_API_KEY=... EUREX_API_KEY=...
    python evals/run_evals.py --mode tools            # model gets the MCP-equivalent tools
    python evals/run_evals.py --mode docs             # model gets ai.md and one raw GraphQL tool
    python evals/run_evals.py --mode tools --only tick-simple,exp-next --out result.json

Checks per case (evals/questions.json, key `expect`):
  tools_any       (tools mode) at least one of these tools was called
  datasets_all    (docs mode) every root query name appears in some query the model sent
  contains_any    the answer contains one of these strings (case-insensitive)
  answer_cites    the answer contains a value of one of these fields taken from the tool results (live ground truth)
  and always:     no more than --max-tool-errors tool calls failed
Reported: pass rate, tool calls per case, tool errors, tokens. Run both modes and compare after changing ai.md or the tools.
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from eurex_mcp import definitions, tools  # noqa: E402
from eurex_mcp.client import EurexClient, EurexError  # noqa: E402

DEFAULT_MODEL = 'claude-sonnet-5-5'
TOOLS_SYSTEM = ('You answer questions about Eurex reference data using the provided tools. Find product codes with search_products, '
                'never guess, and name the product, the dataset and the as_of date in your answer. Be concise.')
GRAPHQL_TOOL = {
    'name': 'graphql_request',
    'description': 'POST a GraphQL query to the Eurex API (endpoint and key are handled for you) and return the JSON response.',
    'input_schema': {'type': 'object', 'properties': {'query': {'type': 'string'}, 'variables': {'type': 'object'}}, 'required': ['query']},
}
MAX_RESULT_CHARS = 30000


def load_cases(path=None, only=None):
    with open(path or os.path.join(ROOT, 'evals', 'questions.json'), encoding='utf-8') as f:
        cases = json.load(f)['cases']
    if only:
        wanted = set(only)
        cases = [c for c in cases if c['id'] in wanted]
    return cases


def collect_values(obj, keys, out=None):
    """All scalar values stored under any of `keys` anywhere in a JSON structure."""
    out = set() if out is None else out
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in keys and isinstance(v, (str, int, float)) and not isinstance(v, bool):
                out.add(str(v))
            collect_values(v, keys, out)
    elif isinstance(obj, list):
        for v in obj:
            collect_values(v, keys, out)
    return out


def score(case, answer, calls, mode, max_tool_errors=2):
    """calls: [{'name', 'input', 'result' (parsed JSON or text), 'error' (bool)}]. Returns (passed, [reasons])."""
    expect, fails, text = case.get('expect', {}), [], (answer or '')
    low = text.lower()
    if not text.strip():
        fails.append('no answer')
    if mode == 'tools' and expect.get('tools_any') and not {c['name'] for c in calls} & set(expect['tools_any']):
        fails.append(f'none of the tools {expect["tools_any"]} was called')
    if mode == 'docs' and expect.get('datasets_all'):
        sent = ' '.join(str(c['input'].get('query', '')) for c in calls)
        missing = [d for d in expect['datasets_all'] if d not in sent]
        if missing:
            fails.append(f'no query touched {missing}')
    if expect.get('contains_any') and not any(s.lower() in low for s in expect['contains_any']):
        fails.append(f'answer lacks any of {expect["contains_any"]}')
    if expect.get('answer_cites'):
        values = set()
        for c in calls:
            collect_values(c['result'], set(expect['answer_cites']), values)
        if not values:
            fails.append(f'tool results had no {expect["answer_cites"]} to cite')
        elif not any(v in text or v.lower() in low for v in values if len(v) > 0):
            fails.append(f'answer cites none of the {expect["answer_cites"]} values returned by the API')
    errors = sum(1 for c in calls if c['error'])
    if errors > max_tool_errors:
        fails.append(f'{errors} tool calls failed')
    return not fails, fails


def _block(b, attr, default=None):
    return b.get(attr, default) if isinstance(b, dict) else getattr(b, attr, default)


def run_case(api, eurex, case, mode, model, max_turns=10, system_docs=None):
    if mode == 'tools':
        system, tool_defs = TOOLS_SYSTEM, definitions.claude_tools()
    else:
        system, tool_defs = system_docs, [GRAPHQL_TOOL]
    messages = [{'role': 'user', 'content': case['question']}]
    calls, usage, answer = [], {'input': 0, 'output': 0}, ''
    for _ in range(max_turns):
        resp = api.messages.create(model=model, max_tokens=2048, system=system, tools=tool_defs, messages=messages)
        usage['input'] += _block(_block(resp, 'usage', {}), 'input_tokens', 0) or 0
        usage['output'] += _block(_block(resp, 'usage', {}), 'output_tokens', 0) or 0
        content = _block(resp, 'content')
        messages.append({'role': 'assistant', 'content': content})
        uses = [b for b in content if _block(b, 'type') == 'tool_use']
        if _block(resp, 'stop_reason') != 'tool_use' or not uses:
            answer = ''.join(_block(b, 'text', '') for b in content if _block(b, 'type') == 'text')
            break
        results = []
        for b in uses:
            name, args = _block(b, 'name'), _block(b, 'input') or {}
            if mode == 'tools':
                result = tools.call(eurex, name, args)
                err = not result.get('ok')
            else:
                try:
                    result, err = {'data': eurex.query(args.get('query', ''), args.get('variables') or None)}, False
                except EurexError as e:
                    result, err = e.to_dict(), True
            calls.append({'name': name, 'input': args, 'result': result, 'error': err})
            text = json.dumps(result, ensure_ascii=False)
            if len(text) > MAX_RESULT_CHARS:
                text = text[:MAX_RESULT_CHARS] + ' ...[truncated]'
            results.append({'type': 'tool_result', 'tool_use_id': _block(b, 'id'), 'content': text, 'is_error': err})
        messages.append({'role': 'user', 'content': results})
    else:
        answer = answer or ''
    return answer, calls, usage


def summarize(results):
    n = len(results)
    passed = sum(r['passed'] for r in results)
    return {'cases': n, 'passed': passed, 'pass_rate': round(passed / n, 3) if n else 0,
            'tool_calls_per_case': round(sum(len(r['calls']) for r in results) / n, 2) if n else 0,
            'tool_errors': sum(r['tool_errors'] for r in results),
            'input_tokens': sum(r['usage']['input'] for r in results), 'output_tokens': sum(r['usage']['output'] for r in results)}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--mode', choices=['tools', 'docs'], default='tools')
    ap.add_argument('--model', default=os.environ.get('EVAL_MODEL', DEFAULT_MODEL))
    ap.add_argument('--only', help='comma separated case ids')
    ap.add_argument('--questions')
    ap.add_argument('--max-tool-errors', type=int, default=2)
    ap.add_argument('--out', help='write full results as JSON')
    args = ap.parse_args(argv)
    try:
        import anthropic
    except ImportError:
        sys.exit('pip install -r requirements-evals.txt')
    api = anthropic.Anthropic()
    eurex = EurexClient()
    docs = open(os.path.join(ROOT, 'ai.md'), encoding='utf-8').read()
    cases = load_cases(args.questions, args.only.split(',') if args.only else None)
    results = []
    for case in cases:
        try:
            answer, calls, usage = run_case(api, eurex, case, args.mode, args.model, system_docs=docs)
            ok, why = score(case, answer, calls, args.mode, args.max_tool_errors)
        except Exception as e:  # keep going: one broken case must not hide the rest
            answer, calls, usage, ok, why = '', [], {'input': 0, 'output': 0}, False, [f'run failed: {e}']
        results.append({'id': case['id'], 'passed': ok, 'reasons': why, 'answer': answer, 'calls': calls, 'usage': usage,
                        'tool_errors': sum(1 for c in calls if c['error'])})
        print(f'{"PASS" if ok else "FAIL"}  {case["id"]:<22} {len(calls)} calls  {"; ".join(why)}')
    summary = summarize(results)
    print(json.dumps({'mode': args.mode, 'model': args.model, **summary}, indent=2))
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump({'mode': args.mode, 'model': args.model, 'summary': summary, 'results': results}, f, indent=2, ensure_ascii=False)
    return 0 if summary['passed'] == summary['cases'] else 1


if __name__ == '__main__':
    sys.exit(main())
