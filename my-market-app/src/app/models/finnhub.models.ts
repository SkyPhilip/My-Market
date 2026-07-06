export interface FinnhubNewsArticle {
  headline: string;
  summary: string;
  source: string;
  url: string;
  image?: string | null;
  datetime: number;
  related?: string | null;
}

/** Curated subset of Finnhub /stock/metric (metric=all) basic financials. */
export interface FinnhubMetrics {
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  peTTM: number | null;
  psTTM: number | null;
  pbAnnual: number | null;
  roeTTM: number | null;
  netMarginTTM: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
  epsGrowth5Y: number | null;
  revenueGrowthYoY: number | null;
  dividendYield: number | null;
}

/** One month's analyst recommendation bucket counts (Finnhub /stock/recommendation). */
export interface FinnhubRecommendation {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

/** Next scheduled earnings report (Finnhub /calendar/earnings). */
export interface FinnhubEarningsDate {
  date: string;   // YYYY-MM-DD
  hour: string;   // 'bmo' (before open) | 'amc' (after close) | 'dmh' | ''
  epsEstimate: number | null;
}

/** A past quarter's EPS actual vs. estimate (Finnhub /stock/earnings). */
export interface FinnhubEarningsSurprise {
  period: string;  // YYYY-MM-DD (quarter end)
  actual: number | null;
  estimate: number | null;
  surprisePercent: number | null;  // already a percent, e.g. 1.09 = +1.09%
}