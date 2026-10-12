"""REST wrapper for clients that cannot speak MCP (OpenAI Actions, Zapier, n8n, Copilot Studio).

GET  /api/v1/tools               list of tools
POST /api/v1/tools/<name>        JSON body = tool arguments; header X-DBP-APIKEY = the caller's own Eurex key
GET  /openapi.json               OpenAPI 3.1 document for the above

The key is forwarded to the Eurex API for that request only. There is no server-side key: this host never
spends a shared quota on behalf of anonymous callers.
"""
from flask import Blueprint, jsonify, request

from . import definitions, tools
from .client import EurexClient

bp = Blueprint('eurex_tools', __name__)

STATUS_BY_KIND = {'input': 400, 'auth': 401, 'rate_limit': 429}
MAX_BODY = 64 * 1024


@bp.get(definitions.API_PREFIX)
def list_tools():
    return jsonify({'tools': definitions.claude_tools()})


@bp.post(definitions.API_PREFIX + '/<name>')
def run_tool(name):
    key = (request.headers.get('X-DBP-APIKEY') or '').strip()
    if not key:
        return jsonify({'ok': False, 'kind': 'auth', 'error': 'Header X-DBP-APIKEY is required.',
                        'hint': 'Get a free key on the Deutsche Börse developer portal.'}), 401
    if name not in tools.TOOLS:
        return jsonify({'ok': False, 'kind': 'input', 'error': f'Unknown tool: {name}'}), 404
    if request.content_length and request.content_length > MAX_BODY:
        return jsonify({'ok': False, 'kind': 'input', 'error': 'Request body too large.'}), 413
    args = request.get_json(silent=True)
    if args is None and not request.get_data():
        args = {}
    if not isinstance(args, dict):
        return jsonify({'ok': False, 'kind': 'input', 'error': 'Body must be a JSON object.'}), 400
    result = tools.call(EurexClient(api_key=key), name, args)
    status = 200 if result.get('ok') else STATUS_BY_KIND.get(result.get('kind'), 502)
    return jsonify(result), status


@bp.get('/openapi.json')
def openapi_document():
    return jsonify(definitions.openapi(request.url_root.rstrip('/')))
