"""MCP server for the Eurex reference-data API.

    pip install -r requirements-mcp.txt
    EUREX_API_KEY=... python -m eurex_mcp.server            # stdio (Claude Desktop, Claude Code, Cursor)
    python -m eurex_mcp.server --http --port 8000            # streamable HTTP

Without EUREX_API_KEY the shared demo key is used (rate limited for everyone).
"""
import argparse
import inspect
import json
import os
import sys
from typing import Annotated, Optional

from pydantic import Field

try:  # mcp >= 2
    from mcp.server.mcpserver import MCPServer as _Server
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as _Server

from . import tools
from .client import EurexClient

INSTRUCTIONS = """Eurex reference data (products, contracts, trading hours, holidays, tick rules, TES parameters, settlement prices). Read-only; no live market data.
Rules: find the product code with search_products first and never guess codes or field names (use get_schema). Prefer the specific tools over run_graphql.
In answers name the product, the dataset and the as_of date. If a tool returns ok=false, read `hint`; do not fill gaps from memory: the API is the source of truth."""

_PY_TYPES = {'string': str, 'integer': int, 'number': float, 'boolean': bool, 'object': dict}


def _wrapper(tool, client):
    """A function whose signature mirrors the tool's JSON schema, so the SDK derives the same input schema."""
    props, required = tool.schema['properties'], set(tool.schema['required'])
    params = []
    for name, spec in props.items():
        py = _PY_TYPES[spec['type']]
        ann = Annotated[py if name in required else Optional[py], Field(description=spec.get('description', ''))]
        params.append(inspect.Parameter(name, inspect.Parameter.KEYWORD_ONLY, annotation=ann,
                                        default=inspect.Parameter.empty if name in required else None))

    def fn(**kwargs):
        # Failures come back as ok=false results the model can read and act on (hint included), not as protocol errors
        return json.dumps(tools.call(client, tool.name, kwargs), ensure_ascii=False)

    fn.__name__ = tool.name
    fn.__doc__ = tool.description
    fn.__signature__ = inspect.Signature(params, return_annotation=str)
    fn.__annotations__ = {p.name: p.annotation for p in params} | {'return': str}
    return fn


def build_server(client=None):
    client = client or EurexClient()
    server = _Server('eurex-reference-data', instructions=INSTRUCTIONS)
    for tool in tools.TOOLS.values():
        server.add_tool(_wrapper(tool, client), name=tool.name, description=tool.description)

    @server.prompt(name='eurex_question', description='Answer a question about Eurex reference data with the tools, following the house rules.')
    def eurex_question(question: str) -> str:
        return (f'Answer this with the Eurex tools: {question}\n\n'
                '1. Find the product code with search_products (never guess).\n'
                '2. Use the most specific tool; use get_schema before writing raw GraphQL.\n'
                '3. Answer in plain words, add a small table for lists, and name the product, the dataset and the as_of date.\n'
                '4. If something is not in the API, say so instead of estimating.')

    @server.resource('eurex://rules', name='rules', description='Rules for agents using the Eurex reference-data API.', mime_type='text/markdown')
    def rules() -> str:
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ai.md')
        try:
            with open(path, encoding='utf-8') as f:
                return f.read()
        except OSError:
            return INSTRUCTIONS

    return server


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--http', action='store_true', help='serve streamable HTTP instead of stdio')
    ap.add_argument('--port', type=int, default=8000)
    args = ap.parse_args(argv)
    client = EurexClient()
    if client.using_demo_key:
        print('eurex-mcp: using the shared demo key (rate limited). Set EUREX_API_KEY for your own.', file=sys.stderr)
    server = build_server(client)
    if args.http:
        try:
            server.run('streamable-http', port=args.port)
        except TypeError:  # mcp 1.x takes the port from its settings
            server.settings.port = args.port
            server.run('streamable-http')
    else:
        server.run('stdio')


if __name__ == '__main__':
    main()
