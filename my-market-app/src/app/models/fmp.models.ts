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
