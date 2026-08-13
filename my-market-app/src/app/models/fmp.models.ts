export interface FmpProfile {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  marketCap: number;
  price: number;
  lastDividend?: number;
  exchange: string;
  exchangeShortName: string;
  country: string;
  isEtf: boolean;
  isFund?: boolean;
  isActivelyTrading: boolean;
}

export interface FmpRatiosTtm {
  symbol: string;
  priceToEarningsRatioTTM?: number;
  dividendYieldTTM?: number;
}

/** Latest annual balance sheet (FMP /stable/balance-sheet-statement). */
export interface FmpBalanceSheet {
  symbol: string;
  date: string;
  cashAndCashEquivalents?: number;
  cashAndShortTermInvestments?: number;
  totalDebt?: number;
}

/** Latest annual cash-flow statement (FMP /stable/cash-flow-statement). */
export interface FmpCashFlow {
  symbol: string;
  date: string;
  operatingCashFlow?: number;
  netCashProvidedByOperatingActivities?: number;
}

/** Enterprise-value breakdown: EV = market cap + total debt − cash. `value` is the dollar residual
 *  after one year of operating cash flow; `evToOcf` is the same idea as a scale-independent ratio
 *  (years of operating cash flow needed to pay back the purchase price). */
export interface FmpCashValue {
  marketCap: number | null;
  totalDebt: number | null;
  cash: number | null;
  operatingCashFlow: number | null;
  enterpriseValue: number | null;
  evToOcf: number | null;
  value: number | null;
}

export interface FmpPeer {
  symbol: string;
  companyName?: string;
  price?: number;
  mktCap?: number;
}

export interface FmpIncomeStatement {
  date: string;
  symbol: string;
  eps?: number;
  epsDiluted?: number;
}

export interface FmpAnalystEstimate {
  symbol: string;
  date: string;
  epsAvg?: number;
  numAnalystsEps?: number;
}

export interface FmpSectorPerformance {
  sector: string;
  changesPercentage: string;
}

export interface FmpScreenerResult {
  symbol: string;
  companyName: string;
  marketCap: number;
  sector: string;
  industry: string;
  beta: number;
  price: number;
  lastAnnualDividend: number;
  volume: number;
  exchange: string;
  exchangeShortName: string;
  country: string;
  isEtf: boolean;
  isFund: boolean;
  isActivelyTrading: boolean;
}

export interface HighYieldStock {
  symbol: string;
  companyName: string;
  sector: string;
  price: number;
  annualDividend: number;
  yieldPct: number;
}
