"""Tool definitions for Claude, OpenAI and OpenAPI, generated from the registry."""
from . import tools

API_PREFIX = '/api/v1/tools'

INSTRUCTIONS = """Eurex reference data (products, contracts, trading hours, holidays, tick rules, TES parameters, settlement prices). Read-only; no live market data.
Rules: find the product code with search_products first and never guess codes or field names (use get_schema). Prefer the specific tools over run_graphql.
In answers name the product, the dataset and the as_of date. If a tool returns ok=false, read `hint`; do not fill gaps from memory: the API is the source of truth."""


def claude_tools():
    """For the Anthropic Messages API `tools` parameter."""
    return [{'name': t.name, 'description': t.description, 'input_schema': t.schema} for t in tools.TOOLS.values()]


def openai_tools():
    """For the OpenAI `tools` parameter (chat completions / responses function tools)."""
    return [{'type': 'function', 'function': {'name': t.name, 'description': t.description, 'parameters': t.schema}} for t in tools.TOOLS.values()]


_RESULT = {
    'type': 'object', 'required': ['ok'],
    'properties': {
        'ok': {'type': 'boolean'},
        'as_of': {'type': 'string', 'description': 'Validity date of the dataset behind the answer.'},
        'error': {'type': 'string'}, 'kind': {'type': 'string'}, 'hint': {'type': 'string'},
    },
    'additionalProperties': True,
}


def openapi(server_url):
    paths = {}
    for t in tools.TOOLS.values():
        paths[f'{API_PREFIX}/{t.name}'] = {'post': {
            'operationId': t.name, 'summary': t.description.split('. ')[0].rstrip('.'), 'description': t.description,
            'security': [{'ApiKey': []}],
            'requestBody': {'required': bool(t.schema['required']), 'content': {'application/json': {'schema': t.schema}}},
            'responses': {
                '200': {'description': 'Result. `ok` is true.', 'content': {'application/json': {'schema': _RESULT}}},
                '400': {'description': 'Invalid input; see `hint`.', 'content': {'application/json': {'schema': _RESULT}}},
                '401': {'description': 'X-DBP-APIKEY missing or rejected.', 'content': {'application/json': {'schema': _RESULT}}},
                '429': {'description': 'Rate limit of the upstream API.', 'content': {'application/json': {'schema': _RESULT}}},
                '502': {'description': 'The Eurex API failed or timed out.', 'content': {'application/json': {'schema': _RESULT}}},
            }}}
    return {
        'openapi': '3.1.0',
        'info': {'title': 'Eurex reference data tools', 'version': '1.0.0',
                 'description': 'Read-only tools over the Eurex GraphQL reference-data API (products, contracts, trading hours, holidays, '
                                'tick rules, TES parameters, settlement prices). Send your own key from the Deutsche Börse developer portal '
                                'in the X-DBP-APIKEY header; it is forwarded to the Eurex API and never stored.'},
        'servers': [{'url': server_url}],
        'paths': paths,
        'components': {'securitySchemes': {'ApiKey': {'type': 'apiKey', 'in': 'header', 'name': 'X-DBP-APIKEY'}}},
    }
