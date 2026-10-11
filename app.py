import os

from flask import Flask, abort, jsonify, request, send_from_directory

ROOT = os.path.dirname(os.path.abspath(__file__))

# No automatic static route: only the files listed in static_file() below are served,
# never the repository itself (app.py, .git, notebooks, tests).
app = Flask(__name__, static_folder=None)

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


# Pages for people and AI agents; GitHub Pages serves the same files from the repository root
@app.route('/ai.html')
def ai_instructions():
    return send_from_directory(ROOT, 'ai.html')


@app.route('/llms.txt')
def llms_txt():
    return send_from_directory(ROOT, 'llms.txt', mimetype='text/plain')


@app.route('/explorer/<path:path>')
def explorer_files(path):
    target = static_file(path)
    if target is None:
        abort(404)
    return send_from_directory(*target)


@app.route('/api/status')
def status():
    return jsonify({'status': 'Flask is running'})


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
