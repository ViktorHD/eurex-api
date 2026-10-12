#!/usr/bin/env python3
"""Write schema.graphql from the live API's introspection, then rebuild the agent assets.

    EUREX_API_KEY=... python scripts/export_schema.py            # writes schema.graphql
    EUREX_API_KEY=... python scripts/export_schema.py --check    # exit 1 when the committed file is out of date
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from eurex_mcp.client import EurexClient  # noqa: E402
from eurex_mcp.sdl import INTROSPECTION_QUERY, schema_to_sdl  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--out', default=os.path.join(ROOT, 'schema.graphql'))
    args = ap.parse_args(argv)
    sdl = schema_to_sdl(EurexClient().query(INTROSPECTION_QUERY, fresh=True)['__schema'])
    if args.check:
        try:
            current = open(args.out, encoding='utf-8').read()
        except OSError:
            current = None
        if current != sdl:
            print('schema.graphql is missing or out of date; run scripts/export_schema.py', file=sys.stderr)
            return 1
        return 0
    with open(args.out, 'w', encoding='utf-8') as f:
        f.write(sdl)
    print(f'wrote {args.out} ({sdl.count(chr(10))} lines)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
