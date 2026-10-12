from datetime import datetime

import pytest

from eurex_mcp import logic


def berlin(s):
    return logic.to_eurex_time(s)


class TestSearch:
    CATALOG = [
        {'Product': 'FESX', 'Name': 'Euro STOXX 50 Index Futures', 'ProductISIN': 'DE0009652644X', 'Underlying': 'EURO STOXX 50'},
        {'Product': 'OESX', 'Name': 'Euro STOXX 50 Index Options', 'ProductISIN': None, 'Underlying': 'EURO STOXX 50'},
        {'Product': 'FDAX', 'Name': 'DAX Futures', 'ProductISIN': None, 'Underlying': 'DAX'},
        {'Product': 'FESXB', 'Name': 'Something else', 'ProductISIN': None},
    ]

    def test_exact_code_beats_prefix_and_text(self):
        assert [p['Product'] for p in logic.search_products(self.CATALOG, 'fesx')][:2] == ['FESX', 'FESXB']

    def test_all_words_must_match(self):
        hits = logic.search_products(self.CATALOG, 'euro stoxx options')
        assert [p['Product'] for p in hits] == ['OESX']

    def test_isin_and_underlying(self):
        assert logic.search_products(self.CATALOG, 'de0009652644x')[0]['Product'] == 'FESX'
        assert logic.search_products(self.CATALOG, 'dax')[0]['Product'] == 'FDAX'

    def test_empty_and_limit(self):
        assert logic.search_products(self.CATALOG, '  ') == []
        assert len(logic.search_products(self.CATALOG, 'euro', limit=1)) == 1


class TestTradingStatus:
    HOURS = [{'StartContinuousTrading': '08:00', 'EndContinuousTrading': '22:00', 'StartTES': '07:30', 'EndTES': '22:15'}]

    def test_phases(self):
        # 2026-10-12 is a Monday
        assert logic.trading_status(self.HOURS, [], '2026-10-12T10:00:00') == 'open'
        assert logic.trading_status(self.HOURS, [], '2026-10-12T22:10:00') == 'tes'
        assert logic.trading_status(self.HOURS, [], '2026-10-12T03:00:00') == 'closed'

    def test_weekend_and_holiday(self):
        assert logic.trading_status(self.HOURS, [], '2026-10-11T12:00:00') == 'closed'  # Sunday
        assert logic.trading_status(self.HOURS, ['2026-12-24'], '2026-12-24T10:00:00') == 'holiday'

    def test_range_over_midnight_and_no_hours(self):
        night = [{'StartContinuousTrading': '22:00', 'EndContinuousTrading': '06:00'}]
        assert logic.trading_status(night, [], '2026-10-13T02:00:00') == 'open'
        assert logic.trading_status([], [], '2026-10-12T10:00:00') == 'closed'

    def test_utc_instants_are_converted_to_berlin_time(self):
        # 07:30Z in summer time is 09:30 in Berlin
        assert logic.trading_status(self.HOURS, [], '2026-10-12T07:30:00Z') == 'open'
        assert logic.trading_status(self.HOURS, [], '2026-10-12T05:00:00Z') == 'closed'  # 07:00 local: before TES and trading start
        assert logic.to_eurex_time('2026-07-01T12:00:00Z').hour == 14

    def test_bad_timestamp(self):
        with pytest.raises(ValueError):
            logic.to_eurex_time('tomorrow-ish')

    def test_holiday_dates(self):
        assert logic.holiday_dates([{'Holiday': '2026-12-25T00:00:00'}, {'Holiday': 'x'}, {'Holiday': '2026-01-01'}]) == ['2026-01-01', '2026-12-25']


class TestTicks:
    ROWS = [
        {'TradeType': 'ORDER_BOOK', 'InstrumentType': 'SIMPLE_INSTRUMENT', 'StartPrice': 0, 'EndPrice': 10, 'PriceStep': 0.1},
        {'TradeType': 'ORDER_BOOK', 'InstrumentType': 'SIMPLE_INSTRUMENT', 'StartPrice': 10, 'EndPrice': None, 'PriceStep': 0.5},
        {'TradeType': 'ORDER_BOOK', 'InstrumentType': 'STRATEGY', 'StartPrice': None, 'EndPrice': None, 'PriceStep': 0.01},
    ]

    def bands(self, **kw):
        return logic.resolve_tick_rules(self.ROWS, **kw)[0]

    def test_step_at_band_edges(self):
        b = self.bands()
        assert logic.check_price(b, 9.9)['step'] == 0.1
        assert logic.check_price(b, 10)['step'] == 0.5  # next band starts at 10: EndPrice excluded
        assert logic.check_price(b, 5000)['step'] == 0.5

    def test_validity_and_neighbours_without_float_noise(self):
        b = self.bands()
        assert logic.check_price(b, 0.3)['valid'] is True
        r = logic.check_price(b, 100.25)
        assert r == {'step': 0.5, 'valid': False, 'below': 100.0, 'above': 100.5}

    def test_open_ended_start(self):
        b = self.bands(instrument_type='STRATEGY')
        assert logic.check_price(b, 1.234)['step'] == 0.01

    def test_block_falls_back_to_order_book(self):
        bands, trade, instr, fallback = logic.resolve_tick_rules(self.ROWS, 'BLOCK', 'SIMPLE_INSTRUMENT')
        assert fallback is True and trade == 'ORDER_BOOK' and len(bands) == 2

    def test_price_outside_all_bands(self):
        assert logic.check_price([{'start': logic.Decimal(1), 'end': logic.Decimal(2), 'step': logic.Decimal('0.1')}], 5)['step'] is None

    def test_not_a_number(self):
        with pytest.raises(ValueError):
            logic.check_price(self.bands(), 'abc')


class TestTes:
    PROFILES = [
        {'TESType': 'TES', 'InstrumentType': 'SIMPLE', 'MinExpiryRange': 1, 'MinLotSize': 50, 'NonDisclosureLimit': 500},
        {'TESType': 'TES', 'InstrumentType': 'SIMPLE', 'MinExpiryRange': 7, 'MinLotSize': 10, 'NonDisclosureLimit': 100},
        {'TESType': 'TES', 'InstrumentType': 'STRAT', 'MinExpiryRange': 1, 'MinLotSize': 5},
    ]

    def test_tier_applies_from_its_expiry_index(self):
        tiers = logic.tes_tiers(self.PROFILES, 'TES', 'SIMPLE')
        exps = [{'ExpirationIndex': i, 'ExpirationDate': f'2026-{i:02d}-15', 'MasterContract': 'M'} for i in (1, 6, 7, 9)]
        sizes = [r['MinLotSize'] for r in logic.tes_for_expirations(exps, tiers)]
        assert sizes == [50, 50, 10, 10]

    def test_groups(self):
        assert {(g['TESType'], g['InstrumentType']): g['profiles'] for g in logic.tes_groups(self.PROFILES)} == {('TES', 'SIMPLE'): 2, ('TES', 'STRAT'): 1}


def test_group_strikes():
    rows = [{'ContractDate': '2026-12', 'Strike': 5000, 'CallPut': 'C'}, {'ContractDate': '2026-12', 'Strike': 5000, 'CallPut': 'P'},
            {'ContractDate': '2026-12', 'Strike': 4900, 'CallPut': 'P'}, {'ContractDate': '2026-11', 'Strike': 1, 'CallPut': 'C'},
            {'ContractDate': '2026-11', 'Strike': None}]
    g = logic.group_strikes(rows)
    assert list(g) == ['2026-11', '2026-12']
    assert g['2026-12'] == {'calls': [5000], 'puts': [4900, 5000], 'strikes': [4900, 5000]}
