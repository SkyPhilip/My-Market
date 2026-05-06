export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUBMITTED' | 'ACCOUNT_UPDATED';
  equity: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  crypto_status: string;
  currency: string;
}

export interface AlpacaClock {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
}

export interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number;
  vw: number;
}

export interface AlpacaBarsResponse {
  bars: AlpacaBar[];
  symbol: string;
  next_page_token: string | null;
}

export interface AlpacaSnapshot {
  latestTrade: { p: number; s: number; t: string } | null;
  latestQuote: { ap: number; bp: number } | null;
  minuteBar: { o: number; h: number; l: number; c: number; v: number; t: string } | null;
  dailyBar: { o: number; h: number; l: number; c: number; v: number; t: string } | null;
  prevDailyBar: { o: number; h: number; l: number; c: number; v: number; t: string } | null;
}

export type AlpacaSnapshotsResponse = Record<string, AlpacaSnapshot>;

export interface AlpacaErrorBody {
  message: string;
  code?: number;
}
