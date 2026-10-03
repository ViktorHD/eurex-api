// Example queries behind the API Overview cards and the "start from an example" buttons.
export const DOMAIN_QUERIES = {
    products: `query {
  ProductInfos(filter: { Product: { eq: "FESX" } }) {
    date
    data {
      Product
      Name
      ProductISIN
      ProductLine
      ProductType
      LiquidityClass
      Currency
      ContractSize
      TickSize
      TickValue
      SettlementType
      Underlying
      UnderlyingISIN
    }
  }
  Contracts(filter: { Product: { eq: "FESX" } }) {
    date
    data {
      Contract
      ISIN
      ContractDate
      ExpirationDate
      FirstTradingDate
      LastTradingDate
      PreviousDaySettlementPrice
    }
  }
}`,

    calendar: `query {
  TradingHours(filter: { Product: { eq: "FESX" } }) {
    date
    data {
      Product
      StartContinuousTrading
      EndOpeningAuction
      EndContinuousTrading
      EndClosingAuction
      StartTES
      EndTES
      LTDBook
      LTDTES
    }
  }
  Holidays(filter: { Product: { eq: "FESX" } }, sort: { field: Holiday, order: ASC }) {
    date
    data {
      Product
      Holiday
      ExchangeHoliday
    }
  }
}`,

    parameters: `query {
  TickRules(filter: { Product: { eq: "FESX" } }) {
    date
    data {
      Product
      TradeType
      InstrumentType
      StartPrice
      EndPrice
      PriceStep
    }
  }
  TESProfiles(filter: { Product: { eq: "FESX" } }) {
    date
    data {
      Product
      TESType
      InstrumentType
      PriceValidationRule
      AllowAutoApproval
      AllowBroker
      MinLotSize
      MinLotSizeNonPrimary
      MinExpiryRange
      NonDisclosureLimit
      TESminStep
      MaxTrader
      LegPriceEntry
    }
  }
}`,

    flexible: `query {
  FlexibleContracts(filter: { Product: { eq: "OESX" } }, sort: { field: ContractID, order: ASC }) {
    date
    data {
      ContractID
      Contract
      ISIN
      CallPut
      Strike
      ExpirationDate
      SettlementDate
      SettlementPrice
      OpenInterest
      ExerciseStyle
      SettlementType
    }
  }
  SettlementPrices(
    filter: { Product: { eq: "OESX" }, ContractType: { eq: "FLEXIBLE" } }
    sort: { field: ContractID, order: ASC }
  ) {
    date
    data {
      ContractID
      Product
      ContractType
      PriceType
      SettlementPrice
      SettlementDate
    }
  }
}`,

    options: `query {
  Expirations(filter: { Product: { eq: "OESX" } }) {
    date
    data {
      ProductID
      Product
      MasterContract
      ExpirationIndex
      ExpirationDate
    }
  }
  Contracts(filter: { Product: { eq: "OESX" } }) {
    date
    data {
      Contract
      ISIN
      ContractDate
      ContractCycle
      ExpirationDate
      CallPut
      Strike
      OptionsDelta
      PreviousDaySettlementPrice
    }
  }
}`
};
