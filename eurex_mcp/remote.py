"""Hosted MCP endpoint: `POST /mcp` (streamable HTTP, stateless, JSON responses).

Paste the URL into any MCP client that supports remote servers; no install. Tools only.
Key: header `X-DBP-APIKEY` or `Authorization: Bearer <key>`. Without a key the shared demo key is used,
limited per client address so that one caller cannot use up the quota for everybody.
"""
import json
import os
import threading
import time
from collections import defaultdict, deque

from flask import Blueprint, Response, jsonify, request

from . import tools
from .client import DEMO_KEY, EurexClient
from .definitions import INSTRUCTIONS

bp = Blueprint('eurex_remote_mcp', __name__)

SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
DEMO_CALLS_PER_MINUTE = int(os.environ.get('EUREX_DEMO_CALLS_PER_MINUTE', '20'))
MAX_BODY = 64 * 1024
CORS = {'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-DBP-APIKEY, Mcp-Protocol-Version, Mcp-Session-Id',
        'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600'}

_hits = defaultdict(deque)
_lock = threading.Lock()


def _rpc_error(id_, code, message):
    return {'jsonrpc': '2.0', 'id': id_, 'error': {'code': code, 'message': message}}


def _demo_limited(who, now=None):
    now = time.monotonic() if now is None else now
    with _lock:
        q = _hits[who]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= DEMO_CALLS_PER_MINUTE:
            return True
        q.append(now)
        if len(_hits) > 5000:  # forget idle callers
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > 60]:
                _hits.pop(k, None)
        return False


def handle(message, client, who='', demo=False):
    """One JSON-RPC message -> response dict, or None for notifications."""
    if not isinstance(message, dict) or message.get('jsonrpc') != '2.0' or 'method' not in message:
        return _rpc_error(message.get('id') if isinstance(message, dict) else None, -32600, 'Invalid request')
    method, id_, params = message['method'], message.get('id'), message.get('params') or {}
    if 'id' not in message:
        return None  # notifications (initialized, cancelled, ...) need no answer
    if method == 'initialize':
        asked = params.get('protocolVersion')
        return {'jsonrpc': '2.0', 'id': id_, 'result': {
            'protocolVersion': asked if asked in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[0],
            'capabilities': {'tools': {'listChanged': False}},
            'serverInfo': {'name': 'eurex-reference-data', 'version': '1.0.0'},
            'instructions': INSTRUCTIONS}}
    if method == 'ping':
        return {'jsonrpc': '2.0', 'id': id_, 'result': {}}
    if method == 'tools/list':
        return {'jsonrpc': '2.0', 'id': id_, 'result': {'tools': [
            {'name': t.name, 'description': t.description, 'inputSchema': t.schema} for t in tools.TOOLS.values()]}}
    if method == 'tools/call':
        name = params.get('name')
        if name not in tools.TOOLS:
            return _rpc_error(id_, -32602, f'Unknown tool: {name}')
        if demo and _demo_limited(who):
            result = {'ok': False, 'kind': 'rate_limit', 'error': 'Demo key limit reached for your address.',
                      'hint': f'At most {DEMO_CALLS_PER_MINUTE} calls per minute without your own key. Wait, or send your own '
                              'free key (Deutsche Börse developer portal) in the X-DBP-APIKEY header.'}
        else:
            result = tools.call(client, name, params.get('arguments') or {})
        return {'jsonrpc': '2.0', 'id': id_, 'result': {
            'content': [{'type': 'text', 'text': json.dumps(result, ensure_ascii=False)}], 'isError': not result.get('ok')}}
    return _rpc_error(id_, -32601, f'Method not found: {method}')


def _key():
    key = (request.headers.get('X-DBP-APIKEY') or '').strip()
    auth = request.headers.get('Authorization') or ''
    if not key and auth.lower().startswith('bearer '):
        key = auth[7:].strip()
    return key


def _reply(body, status=200):
    resp = Response(json.dumps(body, ensure_ascii=False) if body is not None else '', status=status, mimetype='application/json')
    resp.headers.update(CORS)
    return resp


@bp.route('/mcp', methods=['POST', 'GET', 'DELETE', 'OPTIONS'])
def mcp_endpoint():
    if request.method == 'OPTIONS':
        return _reply(None, 204)
    if request.method != 'POST':
        resp = _reply({'error': 'POST JSON-RPC messages to this URL (MCP streamable HTTP, stateless).'}, 405)
        resp.headers['Allow'] = 'POST, OPTIONS'
        return resp
    if request.content_length and request.content_length > MAX_BODY:
        return _reply(_rpc_error(None, -32600, 'Request too large'), 413)
    try:
        payload = json.loads(request.get_data() or b'')
    except ValueError:
        return _reply(_rpc_error(None, -32700, 'Parse error'), 400)
    key = _key()
    client = EurexClient(api_key=key or DEMO_KEY)
    who = (request.headers.get('X-Forwarded-For', '').split(',')[0].strip() or request.remote_addr or '')
    batch = isinstance(payload, list)
    messages = payload if batch else [payload]
    if not messages or len(messages) > 20:
        return _reply(_rpc_error(None, -32600, 'Invalid batch'), 400)
    out = [r for r in (handle(m, client, who, demo=not key) for m in messages) if r is not None]
    if not out:
        return _reply(None, 202)
    return _reply(out if batch else out[0])
