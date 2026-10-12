"""Pure helpers: product search, trading status, tick rules, TES tiers. No network.

Ports of the rules in explorer/*.js (tradingstatus.js, ticks.js, tes.js) so that agents and the Explorer agree.
"""
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from zoneinfo import ZoneInfo


@lru_cache(maxsize=1)
def eurex_tz():
    """Eurex times are CET/CEST, as in explorer/tradingstatus.js. Needs tzdata on systems without a tz database."""
    return ZoneInfo('Europe/Berlin')


# ---------- Product search ----------

def _haystack_fields(p):
    return [p.get(k) for k in ('Product', 'Name', 'ProductISIN', 'Underlying', 'UnderlyingISIN', 'ProductType', 'Currency')]


def search_products(catalog, query, limit=20):
    """Rank catalog rows for a free-text query: exact code > code prefix > name/ISIN/underlying words."""
    q = (query or '').strip().lower()
    if not q:
        return []
    tokens = q.split()
    scored = []
    for p in catalog:
        code = str(p.get('Product') or '').lower()
        isin = str(p.get('ProductISIN') or '').lower()
        hay = ' '.join(str(v) for v in _haystack_fields(p) if v).lower()
        if code == q or isin == q:
            score = 0
        elif code.startswith(q):
            score = 1
        elif all(t in hay for t in tokens):
            score = 2 if any(t in str(p.get('Name') or '').lower() for t in tokens) else 3
        else:
            continue
        scored.append((score, code, p))
    scored.sort(key=lambda s: (s[0], s[1]))
    return [p for _, _, p in scored[:limit]]


# ---------- Time and trading status ----------

def to_eurex_time(at=None):
    """`at` is None (now), a datetime, or an ISO string. Naive values are read as Eurex local time."""
    if at is None:
        return datetime.now(timezone.utc).astimezone(eurex_tz())
    if isinstance(at, str):
        try:
            at = datetime.fromisoformat(at.replace('Z', '+00:00'))
        except ValueError:
            raise ValueError(f'Not an ISO date-time: {at!r}')
    if at.tzinfo is None:
        return at.replace(tzinfo=eurex_tz())
    return at.astimezone(eurex_tz())


def _minutes(t):
    if not t:
        return None
    m = re.match(r'^(\d{1,2}):(\d{2})', str(t))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def _in_range(mins, start, end):
    s, e = _minutes(start), _minutes(end)
    if s is None or e is None:
        return False
    return s <= mins < e if s <= e else (mins >= s or mins < e)


def trading_status(hour_sets, holidays, at=None):
    """'open' (continuous trading), 'tes' (only T7 Entry Service), 'closed' or 'holiday'.

    hour_sets: TradingHours rows. holidays: ISO dates. Weekends are closed, as in the Explorer.
    """
    local = to_eurex_time(at)
    sets = [h for h in (hour_sets or []) if h]
    if not sets or local.weekday() >= 5:
        return 'closed'
    if local.date().isoformat() in set(holidays or []):
        return 'holiday'
    mins = local.hour * 60 + local.minute
    if any(_in_range(mins, h.get('StartContinuousTrading'), h.get('EndContinuousTrading')) for h in sets):
        return 'open'
    if any(_in_range(mins, h.get('StartTES'), h.get('EndTES')) for h in sets):
        return 'tes'
    return 'closed'


def holiday_dates(rows):
    days = set()
    for r in rows or []:
        day = str(r.get('Holiday') or '')[:10]
        if re.match(r'^\d{4}-\d{2}-\d{2}$', day):
            days.add(day)
    return sorted(days)


# ---------- Tick rules ----------

def _norm(v):
    return re.sub(r'[^a-z0-9]', '', str(v or '').lower())


def _dec(v):
    if v is None or v == '':
        return None
    try:
        return Decimal(str(v))
    except InvalidOperation:
        return None


def _bands(rows):
    out = []
    for r in rows:
        step = _dec(r.get('PriceStep'))
        if step is None or step <= 0:
            continue
        start = _dec(r.get('StartPrice'))
        out.append({'start': start if start is not None else Decimal('-Infinity'), 'end': _dec(r.get('EndPrice')), 'step': step})
    return sorted(out, key=lambda b: b['start'])


def resolve_tick_rules(rows, trade_type=None, instrument_type=None):
    """Bands for a trade type / instrument type. Falls back like the Explorer: the order book rules of the
    same instrument type, then of the simple instrument. Returns (bands, used_trade_type, used_instrument_type, fallback)."""
    rows = rows or []
    order_book = next((r.get('TradeType') for r in rows if _norm(r.get('TradeType')) == 'orderbook'), 'ORDER_BOOK')
    simple = next((r.get('InstrumentType') for r in rows if _norm(r.get('InstrumentType')) == 'simpleinstrument'), None)
    if simple is None:  # no simple instrument named as such: start from the first instrument type present
        simple = next((r.get('InstrumentType') for r in rows if r.get('InstrumentType')), '')
    trade_type = trade_type or order_book
    instrument_type = instrument_type or simple

    def pick(t, i):
        return _bands([r for r in rows if _norm(r.get('TradeType')) == _norm(t) and _norm(r.get('InstrumentType')) == _norm(i)])

    own = pick(trade_type, instrument_type)
    if own:
        return own, trade_type, instrument_type, False
    same = pick(order_book, instrument_type)
    if same:
        return same, order_book, instrument_type, True
    base = pick(order_book, simple)
    return base, order_book, simple, bool(base)


def check_price(bands, price):
    """Which tick step applies at `price`, whether the price is on the grid, and the nearest valid prices."""
    p = _dec(price)
    if p is None:
        raise ValueError('price must be a number')
    rule = None
    for b in bands:
        if p < b['start']:
            continue
        if b['end'] is None:
            rule = b
            break
        next_starts_at_end = any(o is not b and o['start'] == b['end'] for o in bands)
        if (p < b['end']) if next_starts_at_end else (p <= b['end']):
            rule = b
            break
    if rule is None:
        return {'step': None, 'valid': False, 'below': None, 'above': None}
    rem = p % rule['step']
    below = p - rem
    above = p if rem == 0 else below + rule['step']
    return {'step': float(rule['step']), 'valid': rem == 0, 'below': float(below), 'above': float(above)}


# ---------- TES thresholds per expiration ----------

def _n(v):
    return 0 if v is None or v == '' else float(v)


def tes_groups(profiles):
    seen = {}
    for p in profiles or []:
        key = (p.get('TESType') or '', p.get('InstrumentType') or '')
        seen[key] = seen.get(key, 0) + 1
    return [{'TESType': k[0], 'InstrumentType': k[1], 'profiles': c} for k, c in seen.items()]


def tes_tiers(profiles, tes_type, instrument_type):
    rows = sorted((p for p in profiles or [] if (p.get('TESType') or '') == tes_type and (p.get('InstrumentType') or '') == instrument_type),
                  key=lambda p: _n(p.get('MinExpiryRange')))
    return [{'from': _n(p.get('MinExpiryRange')), 'MinLotSize': p.get('MinLotSize'),
             'MinLotSizeNonPrimary': p.get('MinLotSizeNonPrimary'), 'NonDisclosureLimit': p.get('NonDisclosureLimit')} for p in rows]


def tes_for_expirations(expirations, tiers):
    """MinExpiryRange is the expiration index (1 = front expiry) FROM which a threshold applies."""
    out = []
    for e in sorted(expirations or [], key=lambda e: (_n(e.get('ExpirationIndex')), str(e.get('ExpirationDate')))):
        idx = _n(e.get('ExpirationIndex'))
        tier = None
        for t in tiers:
            if idx >= t['from']:
                tier = t
        tier = tier or (tiers[0] if tiers else None)
        out.append({'ExpirationIndex': int(idx), 'ExpirationDate': e.get('ExpirationDate'), 'MasterContract': e.get('MasterContract'),
                    'MinLotSize': tier and tier['MinLotSize'], 'MinLotSizeNonPrimary': tier and tier['MinLotSizeNonPrimary'],
                    'NonDisclosureLimit': tier and tier['NonDisclosureLimit']})
    return out


# ---------- Option strikes ----------

def group_strikes(contracts):
    """{ContractDate: {'calls': [...], 'puts': [...], 'strikes': [...]}} with sorted unique strikes."""
    groups = {}
    for c in contracts:
        date = c.get('ContractDate')
        strike = c.get('Strike')
        if date is None or strike is None:
            continue
        g = groups.setdefault(str(date), {'strikes': set(), 'calls': set(), 'puts': set()})
        g['strikes'].add(strike)
        side = str(c.get('CallPut') or '').upper()
        if side.startswith('C'):
            g['calls'].add(strike)
        elif side.startswith('P'):
            g['puts'].add(strike)
    return {d: {k: sorted(v) for k, v in g.items()} for d, g in sorted(groups.items())}
