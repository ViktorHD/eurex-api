"""Tool registry: the single source for the MCP server, REST wrapper, OpenAPI document and tool definitions.

Every handler takes (client, args) and returns a JSON-serialisable dict. Failures raise EurexError.
Results carry `as_of` (the validity date of the dataset) so an answer can state it.
"""
import json
import re
from dataclasses import dataclass
from typing import Any, Callable

from . import logic
from .client import EurexClient, EurexError, ENDPOINT

PRODUCT_RE = re.compile(r'^[A-Za-z0-9_.\-]{1,24}$')
NEEDS_PRODUCT_FILTER = ('Contracts', 'FlexibleContracts', 'SettlementPrices')
PAGEABLE = {'Contracts', 'FlexibleContracts', 'SettlementPrices'}

PRODUCT_INFO_FIELDS = ('ProductID Product Name ProductISIN ProductType ProductTypeCode ProductLine LiquidityClass Currency '
                       'ContractSize TickSize TickValue SettlementType Underlying UnderlyingISIN').split()
HOURS_FIELDS = 'Product StartContinuousTrading EndOpeningAuction EndContinuousTrading EndClosingAuction StartTES EndTES LTDBook LTDTES'.split()
TICK_FIELDS = 'TradeType InstrumentType StartPrice EndPrice PriceStep'.split()
TES_FIELDS = ('TESType InstrumentType PriceValidationRule AllowAutoApproval AllowBroker MinLotSize MinLotSizeNonPrimary '
              'MinExpiryRange NonDisclosureLimit TESminStep MaxTrader LegPriceEntry').split()
EXPIRATION_FIELDS = 'ProductID Product MasterContract ExpirationIndex ExpirationDate'.split()
CONTRACT_FIELDS = ('Contract ISIN ContractDate ContractCycle ExpirationDate FirstTradingDate LastTradingDate CallPut Strike '
                   'OptionsDelta SettlementPrice SettlementDate').split()
SETTLEMENT_FIELDS = 'ContractID Product ContractType PriceType SettlementPrice SettlementDate'.split()
CHANGELOG_FIELDS = 'Date Type OldValue NewValue Description Query'.split()


# ---------- Registry ----------

@dataclass
class Tool:
    name: str
    description: str
    schema: dict
    handler: Callable[[EurexClient, dict], dict]


TOOLS = {}


def _obj(props, required=()):
    return {'type': 'object', 'properties': props, 'required': list(required), 'additionalProperties': False}


def _tool(name, description, props=None, required=()):
    def deco(fn):
        TOOLS[name] = Tool(name, description, _obj(props or {}, required), fn)
        return fn
    return deco


PRODUCT_PROP = {'type': 'string', 'description': 'Eurex product code, e.g. FESX (Euro STOXX 50 futures) or OESX (its options). Use search_products if you only have a name, ISIN or underlying.'}


# ---------- Helpers ----------

def _product(args):
    code = str(args.get('product') or '').strip()
    if not PRODUCT_RE.match(code):
        raise EurexError(f'Not a valid product code: {code!r}.', kind='input', hint='Use search_products to find the code.')
    return code.upper()


def _limit(args, default, maximum=500):
    n = args.get('limit', default)
    if not isinstance(n, int) or isinstance(n, bool) or n < 1:
        raise EurexError('limit must be a positive integer.', kind='input')
    return min(n, maximum)


def _block(root, fields, args='(filter: { Product: { eq: $p } })'):
    return f'  {root}{args} {{ date data {{ {" ".join(fields)} }} }}'


def _rows(data, root):
    node = data.get(root) or {}
    return node.get('date'), list(node.get('data') or [])


def _warnings(data):
    return {'warnings': data['_partial_errors']} if data.get('_partial_errors') else {}


def _product_query(client, product, parts):
    """parts: [(root, fields, extra_args)] -> {root: (date, rows)} in one request."""
    blocks = []
    for root, fields, sort in parts:
        args = '(filter: { Product: { eq: $p } }' + (f', sort: {{ field: {sort}, order: ASC }}' if sort else '') + ')'
        blocks.append(_block(root, fields, args))
    data = client.query('query ($p: String) {\n' + '\n'.join(blocks) + '\n}', {'p': product})
    return {root: _rows(data, root) for root, _, _ in parts}, data


def _today():
    return logic.to_eurex_time().date().isoformat()


def _norm_date(v):
    return re.sub(r'\D', '', str(v or ''))


def fetch_pages(client, root, fields, product, max_rows=2000, page_size=500, sort=None):
    """All rows of a pageable dataset for one product, up to max_rows. Returns (date, rows, truncated)."""
    rows, date, after = [], None, None
    for _ in range(max(1, -(-max_rows // page_size)) + 1):
        page = f'first: {page_size}' + (f', after: {json.dumps(after)}' if after else '')
        sort_arg = f', sort: {{ field: {sort}, order: DESC }}' if sort else ''
        q = (f'query ($p: String) {{ {root}(filter: {{ Product: {{ eq: $p }} }}{sort_arg}, page: {{ {page} }}) '
             f'{{ date data {{ {" ".join(fields)} }} pageInfo {{ hasNextPage endCursor }} }} }}')
        try:
            data = client.query(q, {'p': product})
        except EurexError as e:
            if sort and e.kind == 'graphql' and not rows:
                return fetch_pages(client, root, fields, product, max_rows, page_size, sort=None)
            raise
        node = data.get(root) or {}
        date = node.get('date') or date
        rows.extend(node.get('data') or [])
        info = node.get('pageInfo') or {}
        after = info.get('endCursor')
        if not info.get('hasNextPage') or not after:
            return date, rows[:max_rows], len(rows) > max_rows
        if len(rows) >= max_rows:
            return date, rows[:max_rows], True
    return date, rows[:max_rows], True


def _unknown_product(product):
    return EurexError(f'No product with code {product}.', kind='input',
                      hint='Use search_products to look it up by name, ISIN or underlying; do not guess codes.')


# ---------- Tools ----------

@_tool('get_api_info', 'Describe the Eurex reference-data API and this tool set: endpoint, datasets, whether the shared demo key is in use. Call first if unsure what is available.')
def get_api_info(client, args):
    return {'endpoint': client.endpoint, 'read_only': True, 'using_shared_demo_key': client.using_demo_key,
            'content': 'Eurex reference data: products, contracts, trading hours, holidays, tick rules, TES parameters, settlement prices. No live market data or order books.',
            'datasets': ['ProductInfos', 'Contracts', 'FlexibleContracts', 'Expirations', 'TradingHours', 'Holidays', 'TickRules',
                         'TESProfiles', 'SettlementPrices', 'VendorCodes', 'DeliverableBonds', 'Enlight', 'EnlightResponders', 'Changelog'],
            'tips': ['Find a product code with search_products before anything else.',
                     'Name the product, the dataset and the as_of date in your answer.',
                     'Times in TradingHours are treated as Europe/Berlin (CET/CEST), as in the Explorer.',
                     'Use get_schema instead of guessing field names; run_graphql is the escape hatch.']}


@_tool('search_products', 'Find Eurex products by code, name, ISIN or underlying (case-insensitive, all words must match). Returns code, name, ISIN, type and currency.',
       {'query': {'type': 'string', 'description': 'Search text, e.g. "euro stoxx 50", "DE0009652644" or "FESX".'},
        'limit': {'type': 'integer', 'description': 'Maximum results (default 20).'}}, ['query'])
def search_products(client, args):
    limit = _limit(args, 20, 100)
    data = client.query('query { ProductInfos { date data { ProductID Product Name ProductISIN ProductType ProductLine Currency Underlying UnderlyingISIN } } }')
    date, catalog = _rows(data, 'ProductInfos')
    hits = logic.search_products(catalog, args.get('query'), limit)
    out = {'as_of': date, 'count': len(hits), 'products': hits}
    if not hits:
        out['hint'] = 'No match. Try a shorter text, the ISIN, or the underlying name.'
    return out


@_tool('get_product', 'Product card in one call: master data, trading hours with live status, tick rules, TES profiles, next holidays and upcoming expirations.',
       {'product': PRODUCT_PROP}, ['product'])
def get_product(client, args):
    p = _product(args)
    res, data = _product_query(client, p, [
        ('ProductInfos', PRODUCT_INFO_FIELDS, None), ('TradingHours', HOURS_FIELDS, None), ('TickRules', TICK_FIELDS, None),
        ('TESProfiles', TES_FIELDS, None), ('Holidays', ['Product', 'Holiday', 'ExchangeHoliday'], 'Holiday'),
        ('Expirations', EXPIRATION_FIELDS, 'ExpirationDate')])
    info_date, info = res['ProductInfos']
    if not info:
        raise _unknown_product(p)
    hours_date, hours = res['TradingHours']
    hol_date, hols = res['Holidays']
    days = logic.holiday_dates(hols)
    today = _today()
    exp_date, exps = res['Expirations']
    return {'product': info[0], 'extra_records': len(info) - 1, 'trading_hours': {'as_of': hours_date, 'rows': hours},
            'status_now': logic.trading_status(hours, days), 'tick_rules': {'as_of': res['TickRules'][0], 'rows': res['TickRules'][1]},
            'tes_profiles': {'as_of': res['TESProfiles'][0], 'rows': res['TESProfiles'][1]},
            'holidays': {'as_of': hol_date, 'upcoming': [d for d in days if d >= today][:10]},
            'expirations': {'as_of': exp_date, 'upcoming': [e for e in exps if str(e.get('ExpirationDate') or '')[:10] >= today][:8]},
            'as_of': info_date, **_warnings(data)}


STATUS_TEXT = {'open': 'Continuous trading', 'tes': 'Only the T7 Entry Service (TES) is open', 'closed': 'Closed', 'holiday': 'Exchange holiday: no trading'}


@_tool('get_market_status', 'Is a product trading now (or at a given time)? Computes open / tes / closed / holiday from TradingHours and Holidays. Times are Europe/Berlin.',
       {'product': PRODUCT_PROP, 'at': {'type': 'string', 'description': 'ISO date-time to check, e.g. 2026-12-24T10:00:00. Without a zone it is read as Eurex time (Europe/Berlin). Default: now.'}}, ['product'])
def get_market_status(client, args):
    p = _product(args)
    try:
        local = logic.to_eurex_time(args.get('at'))
    except ValueError as e:
        raise EurexError(str(e), kind='input')
    res, data = _product_query(client, p, [('TradingHours', HOURS_FIELDS, None), ('Holidays', ['Product', 'Holiday', 'ExchangeHoliday'], 'Holiday')])
    hours_date, hours = res['TradingHours']
    if not hours:
        raise EurexError(f'No trading hours found for {p}.', kind='input', hint='Check the code with search_products.')
    days = logic.holiday_dates(res['Holidays'][1])
    status = logic.trading_status(hours, days, local)
    weekend = local.weekday() >= 5
    return {'product': p, 'evaluated_at': local.isoformat(), 'timezone': 'Europe/Berlin', 'status': status, 'meaning': STATUS_TEXT[status],
            'weekend': weekend, 'next_holiday': next((d for d in days if d > local.date().isoformat()), None),
            'trading_hours': hours, 'as_of': hours_date,
            'note': 'Weekends are treated as closed. Phase times come from TradingHours and are read as Europe/Berlin wall-clock time.', **_warnings(data)}


@_tool('get_tick_size', 'Tick (price step) rules of a product: the step that applies at a price, whether the price is on the grid, and the nearest valid prices.',
       {'product': PRODUCT_PROP, 'price': {'type': 'number', 'description': 'Price to check. Omit to get the whole band table.'},
        'trade_type': {'type': 'string', 'description': 'e.g. ORDER_BOOK (default) or BLOCK.'}, 'instrument_type': {'type': 'string', 'description': 'e.g. a simple instrument (default) or a strategy type.'}}, ['product'])
def get_tick_size(client, args):
    p = _product(args)
    res, data = _product_query(client, p, [('TickRules', TICK_FIELDS, None)])
    date, rows = res['TickRules']
    if not rows:
        raise EurexError(f'No tick rules found for {p}.', kind='input', hint='Check the code with search_products.')
    bands, trade, instr, fallback = logic.resolve_tick_rules(rows, args.get('trade_type'), args.get('instrument_type'))
    out = {'product': p, 'as_of': date, 'trade_type_used': trade, 'instrument_type_used': instr, 'fallback_to_order_book': fallback,
           'bands': [{'from': None if b['start'].is_infinite() else float(b['start']), 'to': None if b['end'] is None else float(b['end']),
                      'step': float(b['step'])} for b in bands],
           'combinations': sorted({(r.get('TradeType') or '', r.get('InstrumentType') or '') for r in rows})}
    out['combinations'] = [{'trade_type': a, 'instrument_type': b} for a, b in out['combinations']]
    if args.get('price') is not None:
        try:
            out['check'] = {'price': args['price'], **logic.check_price(bands, args['price'])}
        except ValueError as e:
            raise EurexError(str(e), kind='input')
    return {**out, **_warnings(data)}


@_tool('get_expirations', 'Expiration calendar of a product (upcoming by default), with the expiration index and master contract.',
       {'product': PRODUCT_PROP, 'upcoming_only': {'type': 'boolean', 'description': 'Only expirations from today on (default true).'},
        'limit': {'type': 'integer', 'description': 'Maximum rows (default 12).'}}, ['product'])
def get_expirations(client, args):
    p = _product(args)
    limit = _limit(args, 12)
    res, data = _product_query(client, p, [('Expirations', EXPIRATION_FIELDS, 'ExpirationDate')])
    date, rows = res['Expirations']
    rows.sort(key=lambda e: str(e.get('ExpirationDate') or ''))
    if args.get('upcoming_only', True):
        today = _today()
        rows = [e for e in rows if str(e.get('ExpirationDate') or '')[:10] >= today]
    return {'product': p, 'as_of': date, 'total': len(rows), 'expirations': rows[:limit], **_warnings(data)}


@_tool('get_holidays', 'Exchange holidays of a product (upcoming by default).',
       {'product': PRODUCT_PROP, 'upcoming_only': {'type': 'boolean', 'description': 'Only from today on (default true).'},
        'limit': {'type': 'integer', 'description': 'Maximum rows (default 20).'}}, ['product'])
def get_holidays(client, args):
    p = _product(args)
    limit = _limit(args, 20)
    res, data = _product_query(client, p, [('Holidays', ['Product', 'Holiday', 'ExchangeHoliday'], 'Holiday')])
    date, rows = res['Holidays']
    rows = [r for r in rows if re.match(r'^\d{4}-\d{2}-\d{2}', str(r.get('Holiday') or ''))]
    rows.sort(key=lambda r: str(r['Holiday']))
    if args.get('upcoming_only', True):
        today = _today()
        rows = [r for r in rows if str(r['Holiday'])[:10] >= today]
    return {'product': p, 'as_of': date, 'total': len(rows), 'holidays': rows[:limit], **_warnings(data)}


def _contracts(client, args):
    p = _product(args)
    date, rows, truncated = fetch_pages(client, 'Contracts', CONTRACT_FIELDS, p, max_rows=3000)
    if not rows:
        raise EurexError(f'No contracts found for {p}.', kind='input', hint='Check the code with search_products.')
    if args.get('contract_date'):
        want = _norm_date(args['contract_date'])
        rows = [c for c in rows if _norm_date(c.get('ContractDate')).startswith(want)]
    if args.get('call_put'):
        side = str(args['call_put']).upper()[:1]
        rows = [c for c in rows if str(c.get('CallPut') or '').upper().startswith(side)]
    return p, date, rows, truncated


@_tool('list_contracts', 'Listed series of a product (futures or options), optionally narrowed by contract date (e.g. 2026-12 or 202612) and call/put.',
       {'product': PRODUCT_PROP, 'contract_date': {'type': 'string', 'description': 'Contract month, e.g. 2026-12 or 202612 (prefix match).'},
        'call_put': {'type': 'string', 'description': 'C or P (options only).'}, 'limit': {'type': 'integer', 'description': 'Maximum rows returned (default 100).'}}, ['product'])
def list_contracts(client, args):
    limit = _limit(args, 100)
    p, date, rows, truncated = _contracts(client, args)
    out = {'product': p, 'as_of': date, 'total_matching': len(rows), 'contracts': rows[:limit]}
    if truncated:
        out['note'] = 'The product has more series than were loaded (3000); narrow with contract_date.'
    return out


@_tool('get_strikes', 'Option strikes per contract date of an options product: sorted unique strikes, split into calls and puts.',
       {'product': PRODUCT_PROP, 'contract_date': {'type': 'string', 'description': 'Contract month, e.g. 2026-12 (prefix match). Omit for all.'}}, ['product'])
def get_strikes(client, args):
    p, date, rows, truncated = _contracts(client, args)
    groups = logic.group_strikes(rows)
    out = {'product': p, 'as_of': date, 'contract_dates': groups}
    if not groups:
        out['hint'] = 'No strikes: this is probably a futures product, or the contract_date matches nothing.'
    if truncated:
        out['note'] = 'More series exist than were loaded (3000); narrow with contract_date.'
    return out


@_tool('get_tes_thresholds', 'T7 Entry Service (TES, off-book) minimum lot sizes and non-disclosure limits per expiration, from TESProfiles and Expirations.',
       {'product': PRODUCT_PROP, 'tes_type': {'type': 'string', 'description': 'TESType to use. Default: the first group listed.'},
        'instrument_type': {'type': 'string', 'description': 'InstrumentType to use. Default: the first group listed.'},
        'limit': {'type': 'integer', 'description': 'Maximum expirations (default 12).'}}, ['product'])
def get_tes_thresholds(client, args):
    p = _product(args)
    limit = _limit(args, 12)
    res, data = _product_query(client, p, [('TESProfiles', TES_FIELDS, None), ('Expirations', EXPIRATION_FIELDS, 'ExpirationDate')])
    date, profiles = res['TESProfiles']
    if not profiles:
        raise EurexError(f'No TES profiles found for {p}.', kind='input', hint='Check the code with search_products.')
    groups = logic.tes_groups(profiles)
    tes_type = args.get('tes_type', groups[0]['TESType'])
    instrument = args.get('instrument_type', groups[0]['InstrumentType'])
    tiers = logic.tes_tiers(profiles, tes_type, instrument)
    if not tiers:
        raise EurexError('No TES profile for that TESType / InstrumentType.', kind='input', hint=f'Available groups: {groups}')
    today = _today()
    exps = [e for e in res['Expirations'][1] if str(e.get('ExpirationDate') or '')[:10] >= today]
    return {'product': p, 'as_of': date, 'groups': groups, 'used': {'TESType': tes_type, 'InstrumentType': instrument}, 'tiers': tiers,
            'per_expiration': logic.tes_for_expirations(exps, tiers)[:limit],
            'rule': 'MinExpiryRange is the expiration index (1 = front expiry) from which a threshold applies, until the next one starts.', **_warnings(data)}


@_tool('get_settlement_prices', 'Settlement price history of a product, newest first. Narrow with contract_id, price_type or since to keep the answer small.',
       {'product': PRODUCT_PROP, 'contract_id': {'type': 'string', 'description': 'Only this ContractID.'}, 'price_type': {'type': 'string', 'description': 'Only this PriceType.'},
        'since': {'type': 'string', 'description': 'Only SettlementDate on or after this date (YYYY-MM-DD).'}, 'limit': {'type': 'integer', 'description': 'Maximum rows (default 30).'}}, ['product'])
def get_settlement_prices(client, args):
    p = _product(args)
    limit = _limit(args, 30)
    date, rows, truncated = fetch_pages(client, 'SettlementPrices', SETTLEMENT_FIELDS, p, max_rows=3000, sort='SettlementDate')
    if args.get('contract_id'):
        rows = [r for r in rows if str(r.get('ContractID')) == str(args['contract_id'])]
    if args.get('price_type'):
        rows = [r for r in rows if str(r.get('PriceType')) == str(args['price_type'])]
    if args.get('since'):
        rows = [r for r in rows if str(r.get('SettlementDate') or '')[:10] >= str(args['since'])[:10]]
    rows.sort(key=lambda r: str(r.get('SettlementDate') or ''), reverse=True)
    out = {'product': p, 'as_of': date, 'total_matching': len(rows), 'prices': rows[:limit]}
    if truncated:
        out['note'] = 'More rows exist than were loaded (3000); the newest may be missing. Narrow with since or contract_id.'
    return out


@_tool('get_changes', 'Announced and past changes to the API data (Changelog), newest first; optionally only entries that mention a product code or text.',
       {'mentions': {'type': 'string', 'description': 'Keep entries whose text mentions this (e.g. a product code or dataset name).'},
        'since': {'type': 'string', 'description': 'Only entries dated on or after this (YYYY-MM-DD).'}, 'limit': {'type': 'integer', 'description': 'Maximum rows (default 20).'}})
def get_changes(client, args):
    limit = _limit(args, 20)
    data = client.query('query { Changelog { date data { ' + ' '.join(CHANGELOG_FIELDS) + ' } } }')
    date, rows = _rows(data, 'Changelog')
    if args.get('mentions'):
        needle = str(args['mentions']).lower()
        rows = [r for r in rows if needle in ' '.join(str(r.get(k) or '') for k in CHANGELOG_FIELDS).lower()]
    if args.get('since'):
        rows = [r for r in rows if str(r.get('Date') or '')[:10] >= str(args['since'])[:10]]
    rows.sort(key=lambda r: str(r.get('Date') or ''), reverse=True)
    return {'as_of': date, 'total_matching': len(rows), 'changes': rows[:limit], **_warnings(data)}


def _type_str(t):
    if not t:
        return ''
    if t.get('kind') == 'NON_NULL':
        return _type_str(t.get('ofType')) + '!'
    if t.get('kind') == 'LIST':
        return '[' + _type_str(t.get('ofType')) + ']'
    return t.get('name') or ''


TYPE_REF = 'name kind ofType { name kind ofType { name kind ofType { name kind } } }'


@_tool('get_schema', 'Introspect the GraphQL schema. Without type_name: all datasets (root queries) with arguments. With type_name: the fields, input fields or enum values of that type. Use it instead of guessing names.',
       {'type_name': {'type': 'string', 'description': 'e.g. Contract, or a filter input type name taken from the root query arguments.'}})
def get_schema(client, args):
    name = args.get('type_name')
    if not name:
        data = client.query('{ __schema { queryType { fields { name description args { name type { %s } } type { %s } } } } }' % (TYPE_REF, TYPE_REF))
        fields = data['__schema']['queryType']['fields']
        return {'datasets': [{'name': f['name'], 'description': f.get('description'), 'returns': _type_str(f['type']),
                              'args': {a['name']: _type_str(a['type']) for a in f.get('args', [])}} for f in fields]}
    if not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', str(name)):
        raise EurexError('type_name must be a GraphQL name.', kind='input')
    data = client.query('query ($n: String!) { __type(name: $n) { name kind description fields { name description type { %s } } '
                        'inputFields { name type { %s } } enumValues { name } } }' % (TYPE_REF, TYPE_REF), {'n': name})
    t = data.get('__type')
    if not t:
        raise EurexError(f'No type named {name}.', kind='input', hint='Call get_schema without type_name to list the datasets, then follow the type names.')
    out = {'name': t['name'], 'kind': t['kind'], 'description': t.get('description')}
    if t.get('fields'):
        out['fields'] = [{'name': f['name'], 'type': _type_str(f['type']), 'description': f.get('description')} for f in t['fields']]
    if t.get('inputFields'):
        out['input_fields'] = {f['name']: _type_str(f['type']) for f in t['inputFields']}
    if t.get('enumValues'):
        out['enum_values'] = [v['name'] for v in t['enumValues']]
    return out


def _guard_query(query):
    if re.search(r'\bmutation\b|\bsubscription\b', query):
        raise EurexError('The API is read-only: queries only.', kind='input')
    for root in NEEDS_PRODUCT_FILTER:
        for m in re.finditer(r'\b%s\b\s*(\(([^)]*)\))?' % root, query):
            if not m.group(2) or 'Product' not in m.group(2):
                raise EurexError(f'{root} must be filtered by Product (filter: {{ Product: {{ eq: "FESX" }} }}); without it the result is huge.',
                                 kind='input', hint='Add the filter, or use list_contracts / get_settlement_prices.')


@_tool('run_graphql', 'Escape hatch: run a read-only GraphQL query against the Eurex API and get the raw result. Contracts, FlexibleContracts and SettlementPrices must be filtered by Product. Prefer the specific tools.',
       {'query': {'type': 'string', 'description': 'GraphQL query text.'}, 'variables': {'type': 'object', 'description': 'Optional variables.'},
        'max_chars': {'type': 'integer', 'description': 'Truncate the JSON result to this many characters (default 20000).'}}, ['query'])
def run_graphql(client, args):
    query = str(args.get('query') or '')
    _guard_query(query)
    max_chars = _limit({'limit': args.get('max_chars', 20000)}, 20000, 200000)
    data = client.query(query, args.get('variables') or None)
    text = json.dumps(data, ensure_ascii=False)
    if len(text) > max_chars:
        return {'truncated': True, 'total_chars': len(text), 'partial_json': text[:max_chars],
                'hint': 'Result cut off. Select fewer fields, add filters or use page: { first: N }.'}
    return {'data': data}


# ---------- Dispatch and validation ----------

_JSON_TYPES = {'string': str, 'integer': int, 'number': (int, float), 'boolean': bool, 'object': dict}


def validate_args(tool, args):
    if not isinstance(args, dict):
        raise EurexError('Arguments must be an object.', kind='input')
    props = tool.schema['properties']
    for key in tool.schema['required']:
        if args.get(key) in (None, ''):
            raise EurexError(f'Missing argument: {key}.', kind='input')
    for key, value in args.items():
        if key not in props:
            raise EurexError(f'Unknown argument: {key}. Allowed: {", ".join(props) or "none"}.', kind='input')
        want = _JSON_TYPES[props[key]['type']]
        if value is None:
            continue
        if isinstance(value, bool) and props[key]['type'] in ('integer', 'number'):
            raise EurexError(f'{key} must be {props[key]["type"]}.', kind='input')
        if not isinstance(value, want):
            raise EurexError(f'{key} must be {props[key]["type"]}.', kind='input')


def call(client, name, args=None):
    """Run a tool. Always returns a dict: {'ok': True, ...result} or {'ok': False, 'error': ..., 'kind': ..., 'hint': ...}."""
    tool = TOOLS.get(name)
    if tool is None:
        return {'ok': False, 'error': f'Unknown tool: {name}', 'kind': 'input', 'hint': f'Available: {", ".join(TOOLS)}'}
    args = {k: v for k, v in (args or {}).items() if v is not None}
    try:
        validate_args(tool, args)
        return {'ok': True, **tool.handler(client, args)}
    except EurexError as e:
        return {'ok': False, **e.to_dict()}
