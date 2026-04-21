import os
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder=os.path.dirname(os.path.abspath(__file__)))

ENDPOINT_URL = 'https://dbc-f43533dd-29e2.cloud.databricks.com/serving-endpoints/Eurex_agent/invocations'


@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/api/databricks', methods=['POST'])
def proxy_databricks():
    token = os.environ.get('DATABRICKS_TOKEN', '')
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    try:
        resp = requests.post(ENDPOINT_URL, json=request.json, headers=headers)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({'error': {'message': str(e)}}), 502


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(app.static_folder, path)


if __name__ == '__main__':
    port = int(os.environ.get('DATABRICKS_APP_PORT', 8080))
    app.run(host='0.0.0.0', port=port)
