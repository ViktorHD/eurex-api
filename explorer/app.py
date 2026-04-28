import os
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

ENDPOINT_URL = 'https://dbc-f43533dd-29e2.cloud.databricks.com/serving-endpoints/Eurex_agent/invocations'


@app.route('/api/status')
def status():
    return jsonify({'status': 'Flask is running', 'token_present': bool(os.environ.get('DATABRICKS_TOKEN'))})


@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/api/databricks', methods=['POST'])
def proxy_databricks():
    token = os.environ.get('DATABRICKS_TOKEN', '')
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'

    body = request.json or {}
    messages = body.get('messages', [])

    # Try OpenAI-compatible format first, then MLflow dataframe_records format
    for payload in [
        {'messages': messages},
        {'dataframe_records': [{'messages': messages}]},
    ]:
        try:
            resp = requests.post(ENDPOINT_URL, json=payload, headers=headers, timeout=60)
            if resp.status_code not in (400, 405, 422):
                try:
                    return jsonify(resp.json()), resp.status_code
                except Exception:
                    return resp.text, resp.status_code
        except Exception as e:
            return jsonify({'error': {'message': str(e)}}), 502

    # Return last error with full details
    try:
        return jsonify({'error': {'message': f'HTTP {resp.status_code}', 'detail': resp.text}}), resp.status_code
    except Exception:
        return jsonify({'error': {'message': 'All request formats failed'}}), 502


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(app.static_folder, path)


if __name__ == '__main__':
    port = int(os.environ.get('DATABRICKS_APP_PORT', 8080))
    app.run(host='0.0.0.0', port=port)
