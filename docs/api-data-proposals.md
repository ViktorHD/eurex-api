# Proposed additions to the Eurex GraphQL API

Candidates for new queries, drawn from public information on eurex.com, for the audience of this explorer:
**Eurex traders and clearers**. The API itself is not part of this repository, so this is a specification for the
API team, not an implementation. The explorer (product card, calendar, changelog) is built to pick up new queries
through the schema, see "What the explorer will do with it".

> **Verify before building.** The eurex.com pages could not be opened from the environment this was written in
> (network egress blocked); the sources below come from search results and general knowledge. Each source needs a
> check of its current format, update time and the terms of use for redistribution before work starts. Proposals
> marked *(not verified as public)* are ideas to confirm, not findings.
>
> Out of scope: the Extended Market Data service (intraday settlement prices, trades, open interest), which is a
> paid service.

## Conventions to follow

- Same shape as the existing queries: `Name(filter:, sort:, page:) { date data { … } pageInfo { … } }`, filters on
  `Product` (and `ProductID`) wherever the data is per product.
- `date` is the validity date of the data, so the Info page can show freshness. Daily files get a daily `date`.
- Add each dataset to the `Changelog` when fields change.
- Keep the field names the same as the existing types where they mean the same thing (`Product`, `ProductID`,
  `ContractID`, `MasterContract`, `ExpirationDate`).

## Priorities

| # | Query (proposed) | Audience | Value | Effort |
|---|---|---|---|---|
| 1 | `TradingStatistics` (daily volume and open interest) | Trader | High: liquidity screening, sizing | Medium |
| 2 | `Fees` (price list per product) | Trader, clearer | High: cost per trade, comparison | Low |
| 3 | `RiskParameters` (Prisma liquidation groups, indicative margin) | Clearer | High: margin planning | Medium |
| 4 | `MarginClasses` (securities margin groups and classes) | Clearer | Medium | Low |
| 5 | `ClearingVolumes` | Clearer | Medium | Low |
| 6 | `OtcSettlementPrices` | Clearer | Medium | Medium |
| 7 | `CorporateActions` *(not verified as public)* | Trader | High for single-stock products | Medium |
| 8 | `ProductLaunches` *(not verified as public)* | Trader | Medium | Low |
| 9 | `Circulars` index *(not verified as public)* | Both | Medium | Low |

## 1. TradingStatistics

- **Source:** Statistics at <https://www.eurex.com/ex-en/data/statistics> (daily number of traded contracts, volume,
  open interest and its value; monthly statistics).
- **Why:** the first question after "what are the rules" is "is it liquid". Volume and open interest per product and
  contract, with history, make a sparkline on the product card and a liquidity filter in Products.
- **Draft:**
  ```graphql
  type TradingStatisticsRow {
    Date: String!            # trading day
    Product: String!
    ProductID: Int
    ContractID: Int          # empty for product level rows
    Contract: String
    Volume: Float            # contracts traded
    TradedValue: Float       # when published
    OpenInterest: Float
    OpenInterestValue: Float # in EUR, as published
  }
  ```
  Filter: `Product`, `Date` (`between`, `gte`), `ContractID`. Page on `Date` descending.
- **Notes:** decide on the history depth to expose; offer sorting by `Date` or paging, not both (as elsewhere in
  the API).

## 2. Fees

- **Source:** Product and Price Report <https://www.eurex.com/ex-en/data/trading-files/product-and-price-report>
  (all Eurex products with the prices of the Price List of Eurex Clearing AG).
- **Why:** the cost of a trade per product, side by side with tick size and lot size on the product card.
- **Draft:**
  ```graphql
  type Fee {
    Product: String!
    ProductID: Int
    FeeType: String          # e.g. transaction, TES, exercise, as published
    AccountType: String      # A / P / M, if the report distinguishes them
    Currency: String
    Amount: Float
    UnitBasis: String        # per contract, per notional, ...
    ValidFrom: String
  }
  ```
- **Notes:** the report is a wide file; model it long (one row per fee) so new fee types need no schema change.

## 3. RiskParameters

- **Source:** Risk parameters and initial margins
  <https://www.eurex.com/ex-en/data/clearing-files/risk-parameters> (Prisma liquidation groups, indicative Prisma
  margins for single Eurex-cleared swaps).
- **Why:** clearers need the liquidation group and margin parameters of a product to plan margin; traders use them
  to compare the margin cost of products.
- **Draft:**
  ```graphql
  type RiskParameter {
    Product: String!
    ProductID: Int
    LiquidationGroup: String
    LiquidationGroupSplit: String
    MarginPeriodDays: Int
    ParameterName: String    # as published
    ParameterValue: Float
  }
  ```
- **Notes:** confirm which parts of the file are public and which are member-only.

## 4. MarginClasses

- **Source:** Securities margin groups and classes
  <https://www.eurex.com/ex-en/data/clearing-files/Securities-margin-groups-and-classes> (margin rates and
  historical volatilities per margin group and class).
- **Draft:** `MarginClass { MarginGroup, MarginClass, Product, Rate, HistoricalVolatility, Currency }`.

## 5. ClearingVolumes

- **Source:** Clearing volumes <https://www.eurex.com/ec-en/clear/clearing-volume> (volumes before netting of
  cleared transactions per market and class of instruments).
- **Draft:** `ClearingVolume { Period, Market, InstrumentClass, Volume, Notional, Currency }`, filter on `Period`
  and `Market`.

## 6. OtcSettlementPrices

- **Source:** Eurex OTC Clear settlement prices
  <https://www.eurex.com/ec-en/clear/eurex-otc-clear/settlement-prices>.
- **Draft:** `OtcSettlementPrice { Date, Curve, Tenor, Currency, Rate, PriceType }`; confirm the file layout first,
  it differs from the exchange-traded settlement prices.

## 7. CorporateActions *(not verified as public)*

- **Idea:** adjustments of equity and equity-index options and futures after corporate actions (contract size or
  strike changes, new series). Traders of single-stock products need these before the open.
- **Draft:** `CorporateAction { Date, Product, ProductID, ActionType, Description, AdjustmentFactor, EffectiveDate }`.
- **Check:** whether Eurex publishes these as a public, machine-readable list, and in what form.

## 8. ProductLaunches *(not verified as public)*

- **Idea:** products announced and their first trading day, so Products can show "new" and Calendar can list
  launches. `ProductLaunch { Product, Name, ProductType, AnnouncementDate, FirstTradingDate, CircularReference }`.

## 9. Circulars *(not verified as public)*

- **Idea:** an index of public circulars (title, date, category, link) to complement the `Changelog`, which only
  covers API data. `Circular { Number, Date, Title, Category, Url, Products }` with `Products` listing the product
  codes mentioned, so the explorer's "My products" filter works on it too.

## What the explorer will do with it

| New data | Where it appears |
|---|---|
| TradingStatistics | Product card section "Liquidity" (volume and open interest history chart), Products filter |
| Fees | Product card section "Fees" |
| RiskParameters, MarginClasses | Product card section "Margin" (clearer view) |
| ClearingVolumes, OtcSettlementPrices | New "Clearing" view |
| CorporateActions, ProductLaunches | Calendar events and the "My products" changelog filter |
| Circulars | Info page, filtered by followed products, with `.ics` export |

The product card builds its request from the schema (see `explorer/productquery.js`): a section is added by
listing the root query and its fields there and writing the renderer; nothing else in the app has to change.
