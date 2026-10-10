import os
import threading
import time
from collections import defaultdict, deque
from urllib.parse import urlparse

import requests
from flask import Flask, abort, jsonify, request, send_from_directory

ROOT = os.path.dirname(os.path.abspath(__file__))

# No automatic static route: only the files listed in static_file() below are served,
# never the repository itself (app.py, .git, notebooks, tests).
app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024  # chat history plus GraphQL results sent back as tool output

ENDPOINT_URL = os.environ.get(
    'DATABRICKS_ENDPOINT_URL',
    'https://dbc-f43533dd-29e2.cloud.databricks.com/serving-endpoints/Eurex_agent/invocations',
)

# Built-in assistant: any OpenAI-compatible chat API; OpenRouter's free models by default.
LLM_BASE_URL = os.environ.get('LLM_BASE_URL', 'https://openrouter.ai/api/v1').rstrip('/')
LLM_MODEL = os.environ.get('LLM_MODEL', 'openai/gpt-oss-120b:free')

# The agent endpoint is paid for with the server's token, so it is protected against use by other sites and bursts.
RATE_LIMIT_PER_MINUTE = int(os.environ.get('AGENT_RATE_LIMIT_PER_MINUTE', '20'))  # per client
GLOBAL_LIMIT_PER_MINUTE = int(os.environ.get('AGENT_GLOBAL_LIMIT_PER_MINUTE', '120'))  # all clients together
MAX_MESSAGES = 80
MAX_TOOLS = 5
VALID_ROLES = {'system', 'user', 'assistant', 'tool'}
UPSTREAM_TIMEOUT_SECONDS = 60

PUBLIC_EXTENSIONS = {'.js', '.css', '.png', '.svg', '.ico'}


# ---------- Static files ----------

def static_file(path):
    """Directory and file name to serve for a URL path under /explorer, or None."""
    parts = [p for p in path.split('/') if p]
    if not parts or any(p.startswith('.') or p == 'tests' for p in parts):
        return None
    if os.path.splitext(parts[-1])[1].lower() not in PUBLIC_EXTENSIONS:
        return None
    return os.path.join(ROOT, 'explorer'), '/'.join(parts)


@app.route('/')
def index():
    return send_from_directory(ROOT, 'index.html')


@app.route('/explorer/<path:path>')
def explorer_files(path):
    target = static_file(path)
    if target is None:
        abort(404)
    return send_from_directory(*target)


def llm_key():
    return os.environ.get('LLM_API_KEY') or os.environ.get('OPENROUTER_API_KEY', '')


@app.route('/api/status')
def status():
    # Only whether the assistants are configured, never the keys
    return jsonify({
        'status': 'Flask is running',
        'builtinAssistant': bool(llm_key()),
        'databricksAgent': bool(os.environ.get('DATABRICKS_TOKEN')),
    })


# ---------- Agent proxy protection ----------

_rate_lock = threading.Lock()
_hits = defaultdict(deque)  # client key -> timestamps within the last minute


def client_key():
    # Behind the platform proxy remote_addr is the proxy itself; the last X-Forwarded-For entry is the one it added.
    forwarded = request.headers.get('X-Forwarded-For', '').split(',')[-1].strip()
    return forwarded or request.remote_addr or 'unknown'


def rate_limited(key, now=None):
    """Seconds to wait when `key` (or everyone together) exceeded the limits, else 0. Counts the request otherwise."""
    now = time.monotonic() if now is None else now
    with _rate_lock:
        for k in [k for k, q in _hits.items() if not q or now - q[-1] >= 60]:
            del _hits[k]
        mine = _hits[key]
        total = _hits['*']
        for q in (mine, total):
            while q and now - q[0] >= 60:
                q.popleft()
        for q, limit in ((mine, RATE_LIMIT_PER_MINUTE), (total, GLOBAL_LIMIT_PER_MINUTE)):
            if len(q) >= limit:
                return max(1, int(60 - (now - q[0])) + 1)
        mine.append(now)
        total.append(now)
    return 0


def allowed_hosts():
    hosts = {request.host}
    forwarded_host = request.headers.get('X-Forwarded-Host')
    if forwarded_host:
        hosts.add(forwarded_host.split(',')[0].strip())
    hosts.update(h.strip() for h in os.environ.get('ALLOWED_ORIGINS', '').split(',') if h.strip())
    return hosts


def same_origin():
    """The page that calls the proxy must be this app. Browsers send Origin (or Sec-Fetch-Site) on a POST fetch."""
    origin = request.headers.get('Origin')
    if origin:
        return urlparse(origin).netloc in allowed_hosts()
    return request.headers.get('Sec-Fetch-Site') == 'same-origin'


def validate_body(body):
    """(messages, tools, error). Only chat messages and function tools in the shape the chatbot sends are accepted."""
    if not isinstance(body, dict):
        return None, None, 'Expected a JSON object.'
    messages = body.get('messages')
    if not isinstance(messages, list) or not messages or len(messages) > MAX_MESSAGES:
        return None, None, f'messages must be a list of 1 to {MAX_MESSAGES} chat messages.'
    for m in messages:
        if not isinstance(m, dict) or m.get('role') not in VALID_ROLES:
            return None, None, 'Every message needs a valid role.'
        if m.get('content') is not None and not isinstance(m['content'], str):
            return None, None, 'Message content must be text.'
    tools = body.get('tools')
    if tools is not None:
        if not isinstance(tools, list) or len(tools) > MAX_TOOLS or not all(isinstance(t, dict) for t in tools):
            return None, None, f'tools must be a list of at most {MAX_TOOLS} tool definitions.'
    return messages, tools, None


def payload_variants(messages, tools):
    """Request bodies in the formats a Databricks serving endpoint may expect, most likely first."""
    variants = [
        {'messages': messages, 'tools': tools} if tools else {'messages': messages},
        {'dataframe_records': [{'messages': messages, 'tools': tools} if tools else {'messages': messages}]},
    ]
    if tools:
        variants.append({'messages': messages})
    return variants


def error_response(message, status):
    resp = jsonify({'error': {'message': message}})
    resp.status_code = status
    return resp


def guard(token):
    """(messages, tools, error response). Origin check, configuration check, rate limit and body validation."""
    if not same_origin():
        return None, None, error_response('Requests must come from this application.', 403)
    if not token:
        return None, None, error_response('The AI agent is not configured on this server.', 503)
    wait = rate_limited(client_key())
    if wait:
        resp = error_response('Rate limit exceeded. Please wait and try again.', 429)
        resp.headers['Retry-After'] = str(wait)
        return None, None, resp
    messages, tools, problem = validate_body(request.get_json(silent=True))
    if problem:
        return None, None, error_response(problem, 400)
    return messages, tools, None


@app.route('/api/databricks', methods=['POST'])
def proxy_databricks():
    token = os.environ.get('DATABRICKS_TOKEN', '')
    messages, tools, rejected = guard(token)
    if rejected:
        return rejected

    headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}
    last_status = 502
    for payload in payload_variants(messages, tools):
        try:
            resp = requests.post(ENDPOINT_URL, json=payload, headers=headers, timeout=UPSTREAM_TIMEOUT_SECONDS)
        except requests.RequestException as exc:
            app.logger.warning('Agent endpoint unreachable: %s', exc)
            return error_response('The AI agent could not be reached.', 502)

        last_status = resp.status_code
        # A format the endpoint does not understand: try the next one
        if resp.status_code in (400, 405, 422):
            app.logger.info('Agent endpoint rejected a payload format (HTTP %s): %.300s', resp.status_code, resp.text)
            continue
        try:
            return jsonify(resp.json()), resp.status_code
        except ValueError:
            app.logger.warning('Agent endpoint returned non-JSON (HTTP %s): %.300s', resp.status_code, resp.text)
            return error_response(f'Unexpected response from the AI agent (HTTP {resp.status_code}).', 502)

    # Details stay in the server log; the browser only learns that the agent refused the request
    return error_response(f'The AI agent rejected the request (HTTP {last_status}).', last_status)


@app.route('/api/llm', methods=['POST'])
def proxy_llm():
    """Built-in assistant: forwards the chat to an OpenAI-compatible API with the server's key."""
    key = llm_key()
    messages, tools, rejected = guard(key)
    if rejected:
        return rejected

    payload = {'model': LLM_MODEL, 'messages': messages}
    if tools:
        payload['tools'] = tools
    headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'}
    try:
        resp = requests.post(f'{LLM_BASE_URL}/chat/completions', json=payload, headers=headers, timeout=UPSTREAM_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        app.logger.warning('Assistant endpoint unreachable: %s', exc)
        return error_response('The AI assistant could not be reached.', 502)

    if resp.status_code == 429:
        out = error_response('The free assistant is busy (shared quota reached). Please try again in a minute.', 429)
        out.headers['Retry-After'] = '60'
        return out
    if resp.status_code != 200:
        app.logger.warning('Assistant endpoint returned HTTP %s: %.300s', resp.status_code, resp.text)
        return error_response(f'The AI assistant rejected the request (HTTP {resp.status_code}).', resp.status_code)
    try:
        body = resp.json()
    except ValueError:
        app.logger.warning('Assistant endpoint returned non-JSON: %.300s', resp.text)
        return error_response('Unexpected response from the AI assistant.', 502)
    if not body.get('choices'):
        # OpenRouter reports some upstream failures as HTTP 200 with an error object
        app.logger.warning('Assistant endpoint returned no choices: %.300s', resp.text)
        return error_response('The AI assistant returned no answer. Please try again.', 502)
    return jsonify(body)


@app.after_request
def security_headers(resp):
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    if request.path.startswith('/api/'):
        resp.headers['Cache-Control'] = 'no-store'
    return resp


if __name__ == '__main__':
    port = int(os.environ.get('DATABRICKS_APP_PORT', 8080))
    app.run(host='0.0.0.0', port=port)
