import { Component, OnInit, OnDestroy, computed, signal, inject, input, effect, HostListener, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AlpacaService } from '../../services/alpaca.service';
import { FmpService } from '../../services/fmp.service';
import { FinnhubService } from '../../services/finnhub.service';
import { fetchFnWithState } from '../../utils/fetch-rx';
import { AlpacaErrorBody, AlpacaBarsResponse, AlpacaSnapshotsResponse, AlpacaSnapshot } from '../../models/alpaca.models';
import { FinnhubNewsArticle, FinnhubMetrics, FinnhubRecommendation, FinnhubEarningsDate, FinnhubEarningsSurprise } from '../../models/finnhub.models';
import { ChartComponent, DivergenceType } from '../chart/chart.component';
import { NotificationService } from '../../services/notification.service';
import { WatchlistService } from '../../services/watchlist.service';
import { LineData, CandlestickData, Time } from 'lightweight-charts';

type TimeRange = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'All';

interface RangeConfig {
  timeframe: string;
  getStart: () => string;
}

interface VolumeProfileBin {
  price: number;
  step: number;
  volume: number;
}

interface RangeLevels {
  rangeHigh: number;
  rangeLow: number;
  swingHigh: number | null;
  swingLow: number | null;
}

function buildVolumeProfile(bars: Array<{ l: number; h: number; c: number; v: number }>, binCount = 24): VolumeProfileBin[] {
  if (!bars.length) return [];

  const minPrice = Math.min(...bars.map(bar => bar.l));
  const maxPrice = Math.max(...bars.map(bar => bar.h));
  const totalVolume = bars.reduce((sum, bar) => sum + bar.v, 0);

  if (!(maxPrice > minPrice)) {
    return [{ price: minPrice, step: 1, volume: totalVolume }];
  }

  const step = (maxPrice - minPrice) / binCount;
  const bins = Array.from({ length: binCount }, () => 0);

  for (const bar of bars) {
    const value = bar.c;
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - minPrice) / step)));
    bins[index] += bar.v;
  }

  return bins.map((volume, index) => ({
    price: minPrice + step * (index + 0.5),
    step,
    volume,
  }));
}

function buildRangeLevels(bars: Array<{ t: string; h: number; l: number }>): RangeLevels | null {
  if (!bars.length) return null;

  const dates = Array.from(new Set(bars.map(bar => bar.t.split('T')[0]))).sort();
  if (dates.length < 2) return null;

  const rangeDate = dates[dates.length - 2];
  const rangeDayBars = bars.filter(bar => bar.t.startsWith(rangeDate));
  if (!rangeDayBars.length) return null;

  const rangeHigh = Math.max(...rangeDayBars.map(bar => bar.h));
  const rangeLow = Math.min(...rangeDayBars.map(bar => bar.l));

  let swingHigh: number | null = null;
  let swingLow: number | null = null;
  if (dates.length >= 3) {
    const swingDate = dates[dates.length - 3];
    const swingDayBars = bars.filter(bar => bar.t.startsWith(swingDate));
    if (swingDayBars.length) {
      swingHigh = Math.max(...swingDayBars.map(bar => bar.h));
      swingLow = Math.min(...swingDayBars.map(bar => bar.l));
    }
  }

  return { rangeHigh, rangeLow, swingHigh, swingLow };
}

function buildOpeningRange(bars: Array<{ t: string; h: number; l: number }>, minutes = 15): { high: number; low: number } | null {
  if (!bars.length) return null;
  const openMinutes = 9 * 60 + 30; // 9:30 ET
  const windowBars = bars.filter(bar => {
    const et = new Date(bar.t).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' });
    const [h, m] = et.split(':').map(Number);
    const mins = h * 60 + m;
    return mins >= openMinutes && mins < openMinutes + minutes;
  });
  if (!windowBars.length) return null;
  return { high: Math.max(...windowBars.map(b => b.h)), low: Math.min(...windowBars.map(b => b.l)) };
}

/** ET (America/New_York) calendar date (YYYY-MM-DD) for an ISO bar timestamp. */
function etSessionDate(t: string): string {
  return new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

const RANGE_CONFIGS: Record<TimeRange, RangeConfig> = {
  '1D':  { timeframe: '1Min',   getStart: () => { const d = new Date(); d.setDate(d.getDate() - 5); return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); } },
  '5D':  { timeframe: '15Min',  getStart: () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; } },
  '1M':  { timeframe: '1Hour',  getStart: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0]; } },
  '6M':  { timeframe: '1Day',   getStart: () => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().split('T')[0]; } },
  'YTD': { timeframe: '1Day',   getStart: () => `${new Date().getFullYear()}-01-01` },
  '1Y':  { timeframe: '1Day',   getStart: () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().split('T')[0]; } },
  '5Y':  { timeframe: '1Week',  getStart: () => { const d = new Date(); d.setFullYear(d.getFullYear() - 5); return d.toISOString().split('T')[0]; } },
  'All': { timeframe: '1Month', getStart: () => '2000-01-01' },
};

/** Publishers that typically gate full articles behind a paid subscription. Matched case-insensitively as substrings of Finnhub's `source`. */
const PAYWALLED_SOURCES = [
  'seeking alpha',
  'seekingalpha',
  'bloomberg',
  'wall street journal',
  'wsj',
  'barron',
  'financial times',
  'the economist',
  'new york times',
  'nytimes',
  'business insider',
  'the information',
  'morningstar',
];

/** True when a news article's source is a known subscription-gated publisher. */
function isPaywalledSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return PAYWALLED_SOURCES.some(p => s.includes(p));
}

interface WatchlistRow {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  pegy: number | null;
  pegyLoading: boolean;
  pegyLoaded: boolean;
  dividendYield: number | null;
  costBasis: number | null;
  shares: number | null;
  totalCost: number | null;
  marketValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
  totalGainLoss: number | null;
  totalGainLossPercent: number | null;
  chartData: LineData<Time>[];
  candleData: CandlestickData<Time>[];
  chartLoading: boolean;
  volume: number | null;
  ma20Data: LineData<Time>[];
  maData: LineData<Time>[];
  ma150Data: LineData<Time>[];
  ma200Data: LineData<Time>[];
  volumeData: LineData<Time>[];
  volumeProfileData: VolumeProfileBin[];
  rangeHigh: number | null;
  rangeLow: number | null;
  swingHigh: number | null;
  swingLow: number | null;
  openingRangeHigh: number | null;
  openingRangeLow: number | null;
  sessionShadeUntil: Time | null;
  range: TimeRange;
  showMovingAverage20: boolean;
  showMovingAverage: boolean;
  showMovingAverage150: boolean;
  showMovingAverage200: boolean;
  showRangeLevels: boolean;
  peerSymbol: string | null;
  peerName: string | null;
  peerData: LineData<Time>[];
  peerLoading: boolean;
  metrics: FinnhubMetrics | null;
  metricsLoading: boolean;
  recommendation: FinnhubRecommendation | null;
  recommendationLoading: boolean;
  nextEarnings: FinnhubEarningsDate | null;
  nextEarningsLoaded: boolean;
  earningsSurprises: FinnhubEarningsSurprise[] | null;
}

type SortColumn = 'symbol' | 'name' | 'sector' | 'price' | 'change' | 'changePercent' | 'volume' | 'pegy' | 'dividendYield' | 'costBasis' | 'shares' | 'totalCost' | 'marketValue' | 'gainLoss' | 'gainLossPercent' | 'totalGainLoss' | 'totalGainLossPercent';
type SortDirection = 'asc' | 'desc';

type WatchlistEntry = string | { symbol: string; costBasis: number; shares?: number };

@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [CommonModule, FormsModule, ChartComponent],
  templateUrl: './watchlist.component.html',
  styleUrl: './watchlist.component.scss',
})
export class WatchlistComponent implements OnInit, OnDestroy {
  private static readonly POLL_MS = 30_000;
  private static readonly ROW_REFRESH_MS = 15 * 60 * 1000;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private rowRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private rowRefreshWasOpen = false;
  private lastVisibleRefresh = 0;
  private alpacaService = inject(AlpacaService);
  private fmpService = inject(FmpService);
  private finnhubService = inject(FinnhubService);
  private notificationService = inject(NotificationService);
  private watchlistService = inject(WatchlistService);

  heading = input.required<string>();
  watchlistName = input.required<string>();

  private fetchSnapshots = fetchFnWithState<AlpacaSnapshotsResponse, AlpacaErrorBody, string[]>((symbols: string[]) =>
    this.alpacaService.getSnapshots(symbols)
  );

  watchlistState = computed(() => {
    const snap = this.fetchSnapshots.state();
    return {
      prefetchOrBusy: this.loading() || (this.symbols().length > 0 && snap.prefetchOrBusy),
      errorResOrException: this.symbols().length > 0 ? snap.errorResOrException : null,
    };
  });

  private loading = signal(true);
  private initialized = signal(false);
  private symbols = signal<string[]>([]);
  watchlistRows: WritableSignal<WatchlistRow[]> = signal<WatchlistRow[]>([]);
  newSymbol = '';
  newShares = '';
  newCostBasis = '';
  adding = signal(false);
  addError = signal<string | null>(null);

  private costBasisMap = new Map<string, number>();
  private sharesMap = new Map<string, number>();

  hasCostBasis = computed(() => this.costBasisMap.size > 0);

  portfolioTotalCost = computed(() => {
    return this.watchlistRows().reduce((sum, r) => sum + (r.totalCost ?? 0), 0);
  });

  portfolioMarketValue = computed(() => {
    return this.watchlistRows().reduce((sum, r) => sum + (r.marketValue ?? 0), 0);
  });

  portfolioTotalGainLoss = computed(() => {
    return this.portfolioMarketValue() - this.portfolioTotalCost();
  });

  portfolioTotalGainLossPercent = computed(() => {
    const cost = this.portfolioTotalCost();
    return cost ? +((this.portfolioTotalGainLoss() / cost) * 100).toFixed(2) : 0;
  });

  sortColumn = signal<SortColumn | null>(null);
  sortDirection = signal<SortDirection>('asc');
  expandedSymbols = signal<Set<string>>(new Set());
  peerSymbols = signal<Set<string>>(new Set());
  macdSymbols = signal<Set<string>>(new Set());
  pollSymbols = signal<Set<string>>(new Set());
  divergenceMap = signal<Map<string, DivergenceType[]>>(new Map());
  private readonly EMPTY_DIV: DivergenceType[] = [];
  fullscreenSymbol = signal<string | null>(null);
  readonly timeRanges: TimeRange[] = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'All'];
  openingRangeSymbols = signal<Set<string>>(new Set());
  openingRangeNarrowSymbols = signal<Set<string>>(new Set());
  costBasisSymbols = signal<Set<string>>(new Set());
  trailingStops = signal<Map<string, { pct: number; peak: number; stop: number; expiry: number }>>(new Map());
  readonly trailingStopForm = signal<{ symbol: string; price: number } | null>(null);
  tsPctInput = '';
  tsExpiryInput = '';
  readonly newsPanelOpen = signal(false);
  readonly newsSymbol = signal<string>('');
  readonly newsArticles = signal<FinnhubNewsArticle[]>([]);
  readonly newsLoading = signal(false);
  readonly newsLoadError = signal<string | null>(null);

  private newsRequestSeq = 0;

  readonly hidePaywalledNews = signal(true);

  /** Count of loaded articles whose publisher is subscription-gated. */
  readonly paywalledNewsCount = computed(() =>
    this.newsArticles().filter(a => isPaywalledSource(a.source)).length
  );

  /** Articles shown in the panel, optionally excluding subscription-only sources. */
  readonly visibleNewsArticles = computed(() =>
    this.hidePaywalledNews()
      ? this.newsArticles().filter(a => !isPaywalledSource(a.source))
      : this.newsArticles()
  );

  sortedWatchlistRows = computed(() => {
    const rows = this.watchlistRows();
    const col = this.sortColumn();
    const dir = this.sortDirection();
    if (!col) return rows;

    return [...rows].sort((a, b) => {
      const aVal = a[col];
      const bVal = b[col];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      const cmp = typeof aVal === 'string'
        ? aVal.localeCompare(bVal as string)
        : (aVal as number) - (bVal as number);
      return dir === 'asc' ? cmp : -cmp;
    });
  });

  constructor() {
    // Reconcile rows when another component (index cards, Money Flow) adds a ticker
    // to this watchlist via WatchlistService.
    effect(() => {
      this.watchlistService.version(this.watchlistName())();
      if (!this.initialized()) return;
      const current = this.symbols();
      for (const entry of this.watchlistService.getEntries(this.watchlistName())) {
        const sym = (typeof entry === 'string' ? entry : entry.symbol).toUpperCase();
        if (!current.includes(sym)) {
          this.addTicker(sym);
        }
      }
    });
  }

  ngOnInit(): void {
    this.loadWatchlist();
    this.pollInterval = setInterval(() => this.pollTick(), WatchlistComponent.POLL_MS);
    this.rowRefreshInterval = setInterval(() => this.rowRefreshTick(), WatchlistComponent.ROW_REFRESH_MS);
  }

  ngOnDestroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.rowRefreshInterval) {
      clearInterval(this.rowRefreshInterval);
      this.rowRefreshInterval = null;
    }
  }

  formatVolume(v: number | null): string {
    if (v === null) return '—';
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + 'B';
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
    if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
    return v.toString();
  }

  clearInput(): void {
    this.newSymbol = '';
    this.newShares = '';
    this.newCostBasis = '';
    this.addError.set(null);
  }

  isCurrentHoldings(): boolean {
    return this.watchlistName().toLowerCase() === 'current holdings';
  }

  canSubmitSymbol(): boolean {
    if (!this.newSymbol.trim()) return false;
    if (!this.isCurrentHoldings()) return true;

    const shares = Number(this.newShares);
    const costBasis = Number(this.newCostBasis);
    return Number.isFinite(shares) && shares > 0 && Number.isFinite(costBasis) && costBasis > 0;
  }

  sortBy(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  sortIcon(column: SortColumn): string {
    if (this.sortColumn() !== column) return '';
    return this.sortDirection() === 'asc' ? '▲' : '▼';
  }

  private get storageKey(): string {
    return `watchlist_${this.watchlistName()}`;
  }

  private get trailingStopStorageKey(): string {
    return `trailing_stops_${this.watchlistName()}`;
  }

  /** Restores persisted trailing stops, dropping any that have already expired. */
  private loadTrailingStops(): void {
    const raw = localStorage.getItem(this.trailingStopStorageKey);
    if (!raw) { this.trailingStops.set(new Map()); return; }
    let parsed: Record<string, { pct: number; peak: number; stop: number; expiry: number }>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.trailingStops.set(new Map());
      return;
    }
    const now = Date.now();
    const map = new Map<string, { pct: number; peak: number; stop: number; expiry: number }>();
    for (const [symbol, cfg] of Object.entries(parsed)) {
      if (cfg && typeof cfg.pct === 'number' && typeof cfg.expiry === 'number' && cfg.expiry > now) {
        map.set(symbol, cfg);
      }
    }
    this.trailingStops.set(map);
    this.saveTrailingStops();
  }

  private saveTrailingStops(): void {
    const obj: Record<string, { pct: number; peak: number; stop: number; expiry: number }> = {};
    for (const [symbol, cfg] of this.trailingStops()) {
      obj[symbol] = cfg;
    }
    localStorage.setItem(this.trailingStopStorageKey, JSON.stringify(obj));
  }

  private loadFromStorage(): WatchlistEntry[] | null {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private saveToStorage(): void {
    const entries: WatchlistEntry[] = this.symbols().map(symbol => {
      const costBasis = this.costBasisMap.get(symbol);
      const shares = this.sharesMap.get(symbol);
      if (costBasis != null) {
        const entry: { symbol: string; costBasis: number; shares?: number } = { symbol, costBasis };
        if (shares != null) entry.shares = shares;
        return entry;
      }
      return symbol;
    });
    localStorage.setItem(this.storageKey, JSON.stringify(entries));
  }

  async loadWatchlist(): Promise<void> {
    this.loading.set(true);
    try {
      let rawEntries: WatchlistEntry[] | null = this.loadFromStorage();

      if (!rawEntries) {
        rawEntries = [];
      }

      const initialSymbols: string[] = [];
      this.costBasisMap.clear();
      this.sharesMap.clear();
      for (const entry of rawEntries) {
        if (typeof entry === 'string') {
          initialSymbols.push(entry);
        } else {
          initialSymbols.push(entry.symbol);
          this.costBasisMap.set(entry.symbol, entry.costBasis);
          if (entry.shares != null) {
            this.sharesMap.set(entry.symbol, entry.shares);
          }
        }
      }
      this.symbols.set([...initialSymbols]);
      this.loadTrailingStops();

      if (!initialSymbols.length) {
        this.watchlistRows.set([]);
        return;
      }

      const uncachedSymbols = initialSymbols.filter(s => !this.fmpService.hasProfile(s));
      if (uncachedSymbols.length) {
        try {
          await firstValueFrom(this.fmpService.getProfiles(uncachedSymbols));
        } catch {
          // continue without sector data
        }
      }

      const snapResult = await this.fetchSnapshots(initialSymbols);
      if (!snapResult.okRes?.body) return;

      const snapshots = snapResult.okRes.body;
      const rows: WatchlistRow[] = initialSymbols.map(symbol => {
        const snap: AlpacaSnapshot | undefined = snapshots[symbol];
        const name = this.fmpService.getCachedCompanyName(symbol) ?? symbol;
        const price = snap?.latestTrade?.p ?? snap?.minuteBar?.c ?? null;
        const prevClose = snap?.prevDailyBar?.c ?? null;
        const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
        const changePercent = price && prevClose ? +((change! / prevClose) * 100).toFixed(2) : null;
        const sector = this.fmpService.getCachedSector(symbol) ?? '\u2014';
        const costBasis = this.costBasisMap.get(symbol) ?? null;
        const shares = this.sharesMap.get(symbol) ?? null;
        const totalCost = costBasis !== null && shares !== null ? +(costBasis * shares).toFixed(2) : null;
        const marketValue = price !== null && shares !== null ? +(price * shares).toFixed(2) : null;
        const gainLoss = price !== null && costBasis !== null ? +(price - costBasis).toFixed(2) : null;
        const gainLossPercent = gainLoss !== null && costBasis !== null ? +((gainLoss / costBasis) * 100).toFixed(2) : null;
        const totalGainLoss = marketValue !== null && totalCost !== null ? +(marketValue - totalCost).toFixed(2) : null;
        const totalGainLossPercent = totalGainLoss !== null && totalCost !== null && totalCost !== 0 ? +((totalGainLoss / totalCost) * 100).toFixed(2) : null;
        const volume = snap?.dailyBar?.v ?? null;
        return { symbol, name, sector, price, change, changePercent, pegy: null, pegyLoading: false, pegyLoaded: false, dividendYield: this.#dividendYield(symbol, price), volume, costBasis, shares, totalCost, marketValue, gainLoss, gainLossPercent, totalGainLoss, totalGainLossPercent, chartData: [], candleData: [], chartLoading: false, ma20Data: [], maData: [], ma150Data: [], ma200Data: [], volumeData: [], volumeProfileData: [], rangeHigh: null, rangeLow: null, swingHigh: null, swingLow: null, openingRangeHigh: null, openingRangeLow: null, sessionShadeUntil: null, range: '1D', showMovingAverage20: false, showMovingAverage: false, showMovingAverage150: false, showMovingAverage200: false, showRangeLevels: false, peerSymbol: null, peerName: null, peerData: [], peerLoading: false, metrics: null, metricsLoading: false, recommendation: null, recommendationLoading: false, nextEarnings: null, nextEarningsLoaded: false, earningsSurprises: null };
      });
      this.watchlistRows.set(rows);
      this.saveToStorage();
    } finally {
      this.loading.set(false);
      this.initialized.set(true);
    }
  }

  #dividendYield(symbol: string, price: number | null): number | null {
    const annual = this.fmpService.getCachedLastDividend(symbol);
    return annual && price ? +((annual / price) * 100).toFixed(2) : null;
  }

  #buildRow(symbol: string, snap: AlpacaSnapshot, costBasis: number | null, shares: number | null): WatchlistRow {
    const price = snap.latestTrade?.p ?? snap.minuteBar?.c ?? null;
    const prevClose = snap.prevDailyBar?.c ?? null;
    const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
    const changePercent = price && prevClose ? +((change! / prevClose) * 100).toFixed(2) : null;
    const sector = this.fmpService.getCachedSector(symbol) ?? '—';
    const name = this.fmpService.getCachedCompanyName(symbol) ?? symbol;
    const volume = snap.dailyBar?.v ?? null;
    const totalCost = costBasis !== null && shares !== null ? +(costBasis * shares).toFixed(2) : null;
    const marketValue = price !== null && shares !== null ? +(price * shares).toFixed(2) : null;
    const gainLoss = price !== null && costBasis !== null ? +(price - costBasis).toFixed(2) : null;
    const gainLossPercent = gainLoss !== null && costBasis !== null ? +((gainLoss / costBasis) * 100).toFixed(2) : null;
    const totalGainLoss = marketValue !== null && totalCost !== null ? +(marketValue - totalCost).toFixed(2) : null;
    const totalGainLossPercent = totalGainLoss !== null && totalCost !== null && totalCost !== 0 ? +((totalGainLoss / totalCost) * 100).toFixed(2) : null;
    return { symbol, name, sector, price, change, changePercent, pegy: null, pegyLoading: false, pegyLoaded: false, dividendYield: this.#dividendYield(symbol, price), volume, costBasis, shares, totalCost, marketValue, gainLoss, gainLossPercent, totalGainLoss, totalGainLossPercent, chartData: [], candleData: [], chartLoading: false, ma20Data: [], maData: [], ma150Data: [], ma200Data: [], volumeData: [], volumeProfileData: [], rangeHigh: null, rangeLow: null, swingHigh: null, swingLow: null, openingRangeHigh: null, openingRangeLow: null, sessionShadeUntil: null, range: '1D', showMovingAverage20: false, showMovingAverage: false, showMovingAverage150: false, showMovingAverage200: false, showRangeLevels: false, peerSymbol: null, peerName: null, peerData: [], peerLoading: false, metrics: null, metricsLoading: false, recommendation: null, recommendationLoading: false, nextEarnings: null, nextEarningsLoaded: false, earningsSurprises: null };
  }

  /** Adds a ticker (no cost basis) to this watchlist if not already present. Used by external + buttons. */
  async addTicker(symbol: string): Promise<void> {
    const upper = symbol.trim().toUpperCase();
    if (!upper || this.symbols().includes(upper)) return;
    try {
      const [snapResult] = await Promise.all([
        firstValueFrom(this.alpacaService.getSnapshots([upper])),
        this.fmpService.getCachedSector(upper)
          ? Promise.resolve()
          : firstValueFrom(this.fmpService.getProfiles([upper])),
      ]);
      const snap = snapResult?.body?.[upper];
      if (!snap) {
        this.notificationService.showError(`"${upper}" is not a valid ticker symbol.`);
        return;
      }
      this.symbols.update(s => [...s, upper]);
      this.watchlistRows.update(rows => [...rows, this.#buildRow(upper, snap, null, null)]);
      this.saveToStorage();
    } catch {
      // network/profile errors are non-fatal; the ticker simply isn't added
    }
  }

  hasSymbol(symbol: string): boolean {
    return this.symbols().includes(symbol.trim().toUpperCase());
  }

  isEtf(symbol: string): boolean {
    return this.fmpService.isEtfOrFund(symbol);
  }

  async addSymbol(event: Event): Promise<void> {
    event.preventDefault();
    const symbol = this.newSymbol.trim().toUpperCase();
    if (!symbol) return;

    const requiresHoldingInputs = this.isCurrentHoldings();
    const parsedShares = Number(this.newShares);
    const parsedCostBasis = Number(this.newCostBasis);
    const shares = requiresHoldingInputs ? parsedShares : null;
    const costBasis = requiresHoldingInputs ? parsedCostBasis : null;

    if (requiresHoldingInputs) {
      if (!Number.isFinite(parsedShares) || parsedShares <= 0) {
        const msg = 'Enter a valid share quantity greater than 0.';
        this.addError.set(msg);
        this.notificationService.showError(msg);
        return;
      }
      if (!Number.isFinite(parsedCostBasis) || parsedCostBasis <= 0) {
        const msg = 'Enter a valid cost per share greater than 0.';
        this.addError.set(msg);
        this.notificationService.showError(msg);
        return;
      }
    }

    if (this.symbols().includes(symbol)) {
      this.clearInput();
      return;
    }

    this.adding.set(true);
    this.addError.set(null);
    try {
      const [snapResult] = await Promise.all([
        firstValueFrom(this.alpacaService.getSnapshots([symbol])),
        this.fmpService.getCachedSector(symbol)
          ? Promise.resolve()
          : firstValueFrom(this.fmpService.getProfiles([symbol])),
      ]);
      const snap = snapResult?.body?.[symbol];
      if (!snap) {
        const msg = `"${symbol}" is not a valid ticker symbol.`;
        this.addError.set(msg);
        this.notificationService.showError(msg);
        return;
      }
      const price = snap.latestTrade?.p ?? snap.minuteBar?.c ?? null;
      const prevClose = snap?.prevDailyBar?.c ?? null;
      const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
      const changePercent = price && prevClose ? +((change! / prevClose) * 100).toFixed(2) : null;
      const sector = this.fmpService.getCachedSector(symbol) ?? '\u2014';
      const name = this.fmpService.getCachedCompanyName(symbol) ?? symbol;
      const volume = snap?.dailyBar?.v ?? null;
      const normalizedCostBasis = costBasis !== null ? +costBasis.toFixed(2) : null;
      const normalizedShares = shares !== null ? +shares.toFixed(4) : null;
      const totalCost = normalizedCostBasis !== null && normalizedShares !== null ? +(normalizedCostBasis * normalizedShares).toFixed(2) : null;
      const marketValue = price !== null && normalizedShares !== null ? +(price * normalizedShares).toFixed(2) : null;
      const gainLoss = price !== null && normalizedCostBasis !== null ? +(price - normalizedCostBasis).toFixed(2) : null;
      const gainLossPercent = gainLoss !== null && normalizedCostBasis !== null
        ? +((gainLoss / normalizedCostBasis) * 100).toFixed(2)
        : null;
      const totalGainLoss = marketValue !== null && totalCost !== null ? +(marketValue - totalCost).toFixed(2) : null;
      const totalGainLossPercent = totalGainLoss !== null && totalCost !== null && totalCost !== 0
        ? +((totalGainLoss / totalCost) * 100).toFixed(2)
        : null;

      if (normalizedCostBasis !== null) {
        this.costBasisMap.set(symbol, normalizedCostBasis);
      }
      if (normalizedShares !== null) {
        this.sharesMap.set(symbol, normalizedShares);
      }

      this.symbols.update(s => [...s, symbol]);
      this.watchlistRows.update(rows => [...rows, {
        symbol,
        name,
        sector,
        price,
        change,
        changePercent,
        pegy: null,
        pegyLoading: false,
        pegyLoaded: false,
        dividendYield: this.#dividendYield(symbol, price),
        volume,
        costBasis: normalizedCostBasis,
        shares: normalizedShares,
        totalCost,
        marketValue,
        gainLoss,
        gainLossPercent,
        totalGainLoss,
        totalGainLossPercent,
        chartData: [],
        candleData: [],
        chartLoading: false,
        ma20Data: [],
        maData: [],
        ma150Data: [],
        ma200Data: [],
        volumeData: [],
        volumeProfileData: [],
        rangeHigh: null,
        rangeLow: null,
        swingHigh: null,
        swingLow: null,
        openingRangeHigh: null,
        openingRangeLow: null,
        sessionShadeUntil: null,
        range: '1D',
        showMovingAverage20: false,
        showMovingAverage: false,
        showMovingAverage150: false,
        showMovingAverage200: false,
        showRangeLevels: false,
        peerSymbol: null,
        peerName: null,
        peerData: [],
        peerLoading: false,
        metrics: null,
        metricsLoading: false,
        recommendation: null,
        recommendationLoading: false,
        nextEarnings: null,
        nextEarningsLoaded: false,
        earningsSurprises: null,
      }]);
      this.clearInput();
      this.saveToStorage();
    } finally {
      this.adding.set(false);
    }
  }

  removeSymbol(symbol: string): void {
    this.symbols.update(s => s.filter(sym => sym !== symbol));
    this.watchlistRows.update(rows => rows.filter(r => r.symbol !== symbol));
    this.costBasisMap.delete(symbol);
    this.sharesMap.delete(symbol);
    this.expandedSymbols.update(s => { const next = new Set(s); next.delete(symbol); return next; });
    this.trailingStops.update(m => { const next = new Map(m); next.delete(symbol); return next; });
    this.saveTrailingStops();
    this.saveToStorage();
  }

  exportWatchlist(): void {
    const entries: WatchlistEntry[] = this.symbols().map(symbol => {
      const costBasis = this.costBasisMap.get(symbol);
      const shares = this.sharesMap.get(symbol);
      if (costBasis != null) {
        const entry: { symbol: string; costBasis: number; shares?: number } = { symbol, costBasis };
        if (shares != null) entry.shares = shares;
        return entry;
      }
      return symbol;
    });
    const data = { [this.watchlistName()]: entries };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.watchlistName().replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async importWatchlist(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const entries: WatchlistEntry[] = data[this.watchlistName()] ?? Object.values(data)[0] ?? [];
      localStorage.setItem(this.storageKey, JSON.stringify(entries));
      await this.loadWatchlist();
    } catch {
      // invalid file
    }
    input.value = '';
  }

  toggleChart(symbol: string): void {
    if (this.expandedSymbols().has(symbol)) {
      this.expandedSymbols.update(s => { const next = new Set(s); next.delete(symbol); return next; });
    } else {
      this.expandedSymbols.update(s => new Set(s).add(symbol));
      this.loadChart(symbol);
      this.loadMetrics(symbol);
      this.loadRecommendation(symbol);
      this.loadEarnings(symbol);
    }
  }

  private async loadMetrics(symbol: string): Promise<void> {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    if (!row || row.metrics || row.metricsLoading) return;
    this.patchRow(symbol, { metricsLoading: true });
    try {
      const metrics = await firstValueFrom(this.finnhubService.getBasicFinancials(symbol));
      this.patchRow(symbol, { metrics: metrics ?? null, metricsLoading: false });
    } catch {
      this.patchRow(symbol, { metricsLoading: false });
    }
  }

  private async loadRecommendation(symbol: string): Promise<void> {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    if (!row || row.recommendation || row.recommendationLoading) return;
    this.patchRow(symbol, { recommendationLoading: true });
    try {
      const trends = await firstValueFrom(this.finnhubService.getRecommendationTrends(symbol));
      this.patchRow(symbol, { recommendation: trends?.[0] ?? null, recommendationLoading: false });
    } catch {
      this.patchRow(symbol, { recommendationLoading: false });
    }
  }

  private async loadEarnings(symbol: string): Promise<void> {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    if (!row || row.nextEarningsLoaded) return;
    try {
      const [next, surprises] = await Promise.all([
        firstValueFrom(this.finnhubService.getNextEarnings(symbol)),
        firstValueFrom(this.finnhubService.getEarningsSurprises(symbol)),
      ]);
      this.patchRow(symbol, { nextEarnings: next, earningsSurprises: surprises ?? null, nextEarningsLoaded: true });
    } catch {
      this.patchRow(symbol, { nextEarningsLoaded: true });
    }
  }

  /** Most recent quarter's EPS surprise (last element, since surprises are oldest→newest). */
  latestSurprise(row: WatchlistRow): FinnhubEarningsSurprise | null {
    const list = row.earningsSurprises;
    return list && list.length ? list[list.length - 1] : null;
  }

  /** Whole days until the row's next earnings date (0 if today/past, null if unknown). */
  daysUntilEarnings(row: WatchlistRow): number | null {
    if (!row.nextEarnings) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(row.nextEarnings.date + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return null;
    return Math.max(0, Math.round((d.getTime() - today.getTime()) / 86_400_000));
  }

  earningsHourLabel(hour: string): string {
    return hour === 'bmo' ? 'BMO' : hour === 'amc' ? 'AMC' : '';
  }

  /** Total analyst count for a recommendation month (0 if unknown). */
  recoTotal(reco: FinnhubRecommendation | null): number {
    if (!reco) return 0;
    return reco.strongBuy + reco.buy + reco.hold + reco.sell + reco.strongSell;
  }

  /** Current price's position within the 52-week range, as a 0–100% figure (null if unknown). */
  week52Position(row: WatchlistRow): number | null {
    const m = row.metrics;
    if (!m || m.week52High === null || m.week52Low === null || row.price === null) return null;
    const span = m.week52High - m.week52Low;
    if (span <= 0) return null;
    return Math.max(0, Math.min(100, +(((row.price - m.week52Low) / span) * 100).toFixed(1)));
  }

  readonly pegyTooltip = 'PEGY = (P/E) \u00f7 (EPS growth % + dividend yield %)\nLower is cheaper relative to growth + income.';

  async loadPegy(symbol: string): Promise<void> {
    this.watchlistRows.update(rows => rows.map(r =>
      r.symbol === symbol ? { ...r, pegyLoading: true } : r
    ));
    try {
      const pegyMap = await firstValueFrom(this.fmpService.getPegy([symbol]));
      const pegy = pegyMap.get(symbol) ?? null;
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, pegy, pegyLoaded: true, pegyLoading: false } : r
      ));
    } catch {
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, pegyLoading: false } : r
      ));
    }
  }

  toggleMacd(symbol: string): void {
    this.macdSymbols.update(s => {
      const next = new Set(s);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  }

  togglePoll(symbol: string): void {
    this.pollSymbols.update(s => {
      const next = new Set(s);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  }

  /** Silently refreshes any polled + expanded 1D CHARTS (row data is left to the 15-min refresh), but only while the market is open. */
  private async pollTick(): Promise<void> {
    const symbols = [...this.pollSymbols()].filter(s => this.expandedSymbols().has(s) && this.rangeFor(s) === '1D');
    if (!symbols.length) return;
    try {
      const clock = await firstValueFrom(this.alpacaService.getClock());
      if (!clock?.body?.is_open) return;
    } catch {
      return;
    }
    for (const symbol of symbols) {
      this.loadChart(symbol, true);
    }
  }

  /** 15-minute full-list row refresh. Runs while the market is open, plus one final pass just after
   *  the close so the settled closing price/volume land; otherwise stays idle after hours. */
  private async rowRefreshTick(): Promise<void> {
    if (!this.symbols().length) return;
    let isOpen = false;
    try {
      const clock = await firstValueFrom(this.alpacaService.getClock());
      isOpen = !!clock?.body?.is_open;
    } catch {
      return;
    }
    if (isOpen) {
      this.rowRefreshWasOpen = true;
      await this.refreshRowSnapshots();
    } else if (this.rowRefreshWasOpen) {
      this.rowRefreshWasOpen = false;
      await this.refreshRowSnapshots();
    }
  }

  /** Re-fetches snapshots for every row and updates price/change/volume plus price-derived holdings figures. */
  private async refreshRowSnapshots(): Promise<void> {
    const symbols = this.symbols();
    if (!symbols.length) return;
    let snapshots: AlpacaSnapshotsResponse | null | undefined;
    try {
      const res = await firstValueFrom(this.alpacaService.getSnapshots(symbols));
      snapshots = res?.body;
    } catch {
      return; // row refresh is best-effort
    }
    if (!snapshots) return;

    this.watchlistRows.update(rows => rows.map(r => {
      const snap = snapshots[r.symbol];
      if (!snap) return r;
      const price = snap.latestTrade?.p ?? snap.minuteBar?.c ?? r.price;
      const prevClose = snap.prevDailyBar?.c ?? null;
      const change = price !== null && prevClose ? +(price - prevClose).toFixed(2) : null;
      const changePercent = change !== null && prevClose ? +((change / prevClose) * 100).toFixed(2) : null;
      const volume = snap.dailyBar?.v ?? r.volume;
      const marketValue = price !== null && r.shares !== null ? +(price * r.shares).toFixed(2) : null;
      const gainLoss = price !== null && r.costBasis !== null ? +(price - r.costBasis).toFixed(2) : null;
      const gainLossPercent = gainLoss !== null && r.costBasis !== null ? +((gainLoss / r.costBasis) * 100).toFixed(2) : null;
      const totalGainLoss = marketValue !== null && r.totalCost !== null ? +(marketValue - r.totalCost).toFixed(2) : null;
      const totalGainLossPercent = totalGainLoss !== null && r.totalCost !== null && r.totalCost !== 0 ? +((totalGainLoss / r.totalCost) * 100).toFixed(2) : null;
      const dividendYield = this.#dividendYield(r.symbol, price);
      return { ...r, price, change, changePercent, volume, marketValue, gainLoss, gainLossPercent, totalGainLoss, totalGainLossPercent, dividendYield };
    }));

    // Re-evaluate trailing stops against the refreshed prices.
    for (const r of this.watchlistRows()) {
      if (r.price !== null && this.trailingStops().has(r.symbol)) {
        this.evaluateTrailingStop(r.symbol, r.price);
      }
    }
  }

  divergencesFor(symbol: string): DivergenceType[] {
    return this.divergenceMap().get(symbol) ?? this.EMPTY_DIV;
  }

  hasDivergence(symbol: string, type: DivergenceType): boolean {
    return this.divergencesFor(symbol).includes(type);
  }

  toggleDivergence(symbol: string, type: DivergenceType): void {
    this.divergenceMap.update(m => {
      const next = new Map(m);
      const cur = new Set(next.get(symbol) ?? []);
      if (cur.has(type)) cur.delete(type); else cur.add(type);
      if (cur.size) next.set(symbol, [...cur]); else next.delete(symbol);
      return next;
    });
  }

  togglePeer(symbol: string): void {
    if (this.peerSymbols().has(symbol)) {      this.peerSymbols.update(s => { const next = new Set(s); next.delete(symbol); return next; });
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, peerData: [] } : r
      ));
      return;
    }
    this.peerSymbols.update(s => new Set(s).add(symbol));
    if (!this.expandedSymbols().has(symbol)) {
      this.expandedSymbols.update(s => new Set(s).add(symbol));
      this.loadChart(symbol);
      this.loadMetrics(symbol);
      this.loadRecommendation(symbol);
      this.loadEarnings(symbol);
    } else {
      this.loadPeer(symbol);
    }
  }

  private async loadPeer(symbol: string): Promise<void> {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    const mainData = row?.chartData ?? [];
    if (!mainData.length) return;

    this.watchlistRows.update(rows => rows.map(r =>
      r.symbol === symbol ? { ...r, peerLoading: true, peerData: [] } : r
    ));

    const range = row?.range ?? '1D';
    const config = RANGE_CONFIGS[range];
    const isIntraday = range === '1D' || range === '5D' || range === '1M';

    try {
      const peerSymbol = await firstValueFrom(this.fmpService.getClosestPeer(symbol));
      if (!peerSymbol) {
        console.warn(`No peer found for ${symbol}.`);
        this.watchlistRows.update(rows => rows.map(r =>
          r.symbol === symbol ? { ...r, peerSymbol: null, peerName: null, peerData: [], peerLoading: false } : r
        ));
        return;
      }

      let peerName = this.fmpService.getCachedCompanyName(peerSymbol) ?? null;
      if (!peerName) {
        try {
          const profiles = await firstValueFrom(this.fmpService.getProfiles([peerSymbol]));
          peerName = profiles[0]?.companyName ?? this.fmpService.getCachedCompanyName(peerSymbol) ?? null;
        } catch {
          // company name is best-effort; tooltip falls back to the symbol
        }
      }

      const result = await firstValueFrom(
        this.alpacaService.getBars(peerSymbol, config.timeframe, config.getStart())
      );
      const peerBars = result?.body?.bars ?? [];
      if (!peerBars.length) {
        console.warn(`Peer ${peerSymbol} for ${symbol} has no price data on Alpaca.`);
        this.watchlistRows.update(rows => rows.map(r =>
          r.symbol === symbol ? { ...r, peerSymbol, peerName, peerData: [], peerLoading: false } : r
        ));
        return;
      }

      const mainStart = mainData[0].value;
      const peerBase = peerBars[0].c;
      const peerData: LineData<Time>[] = peerBars.map(bar => {
        const time = isIntraday
          ? ((Math.floor(new Date(bar.t).getTime() / 1000) - new Date(bar.t).getTimezoneOffset() * 60) as Time)
          : (bar.t.split('T')[0] as Time);
        const value = peerBase ? +(mainStart * (bar.c / peerBase)).toFixed(4) : mainStart;
        return { time, value };
      });

      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, peerSymbol, peerName, peerData, peerLoading: false } : r
      ));
    } catch {
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, peerLoading: false } : r
      ));
    }
  }

  private patchRow(symbol: string, patch: Partial<WatchlistRow>): void {
    this.watchlistRows.update(rows => rows.map(r => r.symbol === symbol ? { ...r, ...patch } : r));
  }

  private rangeFor(symbol: string): TimeRange {
    return this.watchlistRows().find(r => r.symbol === symbol)?.range ?? '1D';
  }

  selectRange(symbol: string, range: TimeRange): void {
    const patch: Partial<WatchlistRow> = { range };
    if (range !== '5D') patch.showRangeLevels = false;
    this.patchRow(symbol, patch);
    this.loadChart(symbol);
  }

  toggleRangeLevels(symbol: string): void {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    if (!row || row.range !== '5D') return;
    this.patchRow(symbol, { showRangeLevels: !row.showRangeLevels });
  }

  toggleFullscreen(symbol: string): void {
    this.fullscreenSymbol.update(cur => cur === symbol ? null : symbol);
  }

  @HostListener('document:keydown.escape')
  closeFullscreen(): void {
    if (this.fullscreenSymbol() !== null) this.fullscreenSymbol.set(null);
  }

  /** Refresh polled 1D charts immediately when the tab becomes visible/focused again
   *  (e.g. after unlocking the screen), instead of waiting for the throttled interval. */
  @HostListener('document:visibilitychange')
  @HostListener('window:focus')
  onBecameActive(): void {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - this.lastVisibleRefresh < 2000) return; // coalesce visibilitychange + focus
    this.lastVisibleRefresh = now;
    this.pollTick();
  }

  toggleOpeningRange(symbol: string): void {
    if (this.rangeFor(symbol) !== '1D') return;
    this.openingRangeSymbols.update(s => {
      const next = new Set(s);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  }

  toggleOpeningRangeNarrow(symbol: string): void {
    if (this.rangeFor(symbol) !== '1D') return;
    this.openingRangeNarrowSymbols.update(s => {
      const next = new Set(s);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  }

  private narrowedBound(row: WatchlistRow, bound: 'high' | 'low'): number | null {
    const high = row.openingRangeHigh;
    const low = row.openingRangeLow;
    const raw = bound === 'high' ? high : low;
    if (high === null || low === null) return raw;
    if (!this.openingRangeNarrowSymbols().has(row.symbol)) return raw;
    // Shrink the band width by 25% (keep 75% of the half-range) around its midpoint.
    const mid = (high + low) / 2;
    return +(mid + (raw! - mid) * 0.75).toFixed(4);
  }

  openingRangeHighFor(row: WatchlistRow): number | null {
    return this.narrowedBound(row, 'high');
  }

  openingRangeLowFor(row: WatchlistRow): number | null {
    return this.narrowedBound(row, 'low');
  }

  toggleMovingAverage(symbol: string): void {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    if (!row) return;
    this.patchRow(symbol, { showMovingAverage: !row.showMovingAverage });
  }

  toggleMovingAverage20(symbol: string): void {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    if (!row) return;
    this.patchRow(symbol, { showMovingAverage20: !row.showMovingAverage20 });
  }

  toggleMovingAverage150(symbol: string): void {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    if (!row) return;
    this.patchRow(symbol, { showMovingAverage150: !row.showMovingAverage150 });
  }

  toggleMovingAverage200(symbol: string): void {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    if (!row) return;
    this.patchRow(symbol, { showMovingAverage200: !row.showMovingAverage200 });
  }

  toggleCostBasis(symbol: string): void {
    this.costBasisSymbols.update(s => {
      const next = new Set(s);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  }

  /** Current computed trailing stop level for a symbol (null if none set). */
  trailingStopLevel(symbol: string): number | null {
    return this.trailingStops().get(symbol)?.stop ?? null;
  }

  /** Expiry (epoch ms) of a symbol's trailing stop (null if none set). */
  trailingStopExpiry(symbol: string): number | null {
    return this.trailingStops().get(symbol)?.expiry ?? null;
  }

  /** Trailing stop percentage for a symbol (null if none set). */
  trailingStopPct(symbol: string): number | null {
    return this.trailingStops().get(symbol)?.pct ?? null;
  }

  /** Prompts (via a modal with a calendar) for a trailing stop percentage and expiry, or clears an existing one. */
  toggleTrailingStop(symbol: string): void {
    if (this.trailingStops().has(symbol)) {
      this.trailingStops.update(m => { const next = new Map(m); next.delete(symbol); return next; });
      this.saveTrailingStops();
      return;
    }
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    const price = row?.price ?? (row?.chartData.length ? row.chartData[row.chartData.length - 1].value : null);
    if (price === null || price === undefined) {
      this.notificationService.showError('Current price unavailable; cannot set a trailing stop.');
      return;
    }
    this.tsPctInput = '';
    this.tsExpiryInput = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-CA');
    this.trailingStopForm.set({ symbol, price });
  }

  /** Earliest selectable expiry (tomorrow) for the date picker. */
  minExpiryDate(): string {
    return new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA');
  }

  cancelTrailingStop(): void {
    this.trailingStopForm.set(null);
  }

  /** Validates the modal inputs and creates the persisted trailing stop. */
  confirmTrailingStop(): void {
    const form = this.trailingStopForm();
    if (!form) return;
    const pct = Number(this.tsPctInput);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      this.notificationService.showError('Enter a valid trailing stop percentage between 0 and 100.');
      return;
    }
    if (!this.tsExpiryInput) {
      this.notificationService.showError('Choose an expiry date.');
      return;
    }
    const expiry = new Date(`${this.tsExpiryInput}T23:59:59`).getTime();
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      this.notificationService.showError('Choose a future expiry date.');
      return;
    }
    const { symbol, price } = form;
    const stop = +(price * (1 - pct / 100)).toFixed(4);
    this.trailingStops.update(m => {
      const next = new Map(m);
      next.set(symbol, { pct, peak: price, stop, expiry });
      return next;
    });
    this.saveTrailingStops();
    this.trailingStopForm.set(null);
    if (!this.expandedSymbols().has(symbol)) {
      this.expandedSymbols.update(s => new Set(s).add(symbol));
      this.loadChart(symbol);
      this.loadMetrics(symbol);
      this.loadRecommendation(symbol);
      this.loadEarnings(symbol);
    }
  }

  /** Ratchets the stop up with new highs; removes it (from storage) when the price crosses it or it expires. */
  private evaluateTrailingStop(symbol: string, latestPrice: number): void {
    const config = this.trailingStops().get(symbol);
    if (!config) return;
    if (Date.now() >= config.expiry) {
      this.trailingStops.update(m => { const next = new Map(m); next.delete(symbol); return next; });
      this.saveTrailingStops();
      this.notificationService.showInfo(`${symbol} trailing stop expired.`);
      return;
    }
    const peak = Math.max(config.peak, latestPrice);
    const stop = +(peak * (1 - config.pct / 100)).toFixed(4);
    if (latestPrice <= stop) {
      this.trailingStops.update(m => { const next = new Map(m); next.delete(symbol); return next; });
      this.saveTrailingStops();
      this.notificationService.showError(`${symbol} hit its ${config.pct}% trailing stop at $${stop.toFixed(2)} (price $${latestPrice.toFixed(2)}).`);
      return;
    }
    if (peak !== config.peak || stop !== config.stop) {
      this.trailingStops.update(m => {
        const next = new Map(m);
        next.set(symbol, { ...config, peak, stop });
        return next;
      });
      this.saveTrailingStops();
    }
  }

  async openNews(symbol: string): Promise<void> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) return;

    const requestSeq = ++this.newsRequestSeq;
    this.newsPanelOpen.set(true);
    this.newsSymbol.set(normalizedSymbol);
    this.newsArticles.set([]);
    this.newsLoadError.set(null);
    this.newsLoading.set(true);

    try {
      const articles = await firstValueFrom(this.finnhubService.getNews(normalizedSymbol));
      if (requestSeq !== this.newsRequestSeq) return;
      this.newsArticles.set(articles);
    } catch (error) {
      if (requestSeq !== this.newsRequestSeq) return;
      const message = error instanceof Error ? error.message : `Unable to load documentation for ${normalizedSymbol}.`;
      this.newsLoadError.set(message);
      this.newsArticles.set([]);
    } finally {
      if (requestSeq === this.newsRequestSeq) {
        this.newsLoading.set(false);
      }
    }
  }

  closeNewsPanel(): void {
    this.newsRequestSeq += 1;
    this.newsPanelOpen.set(false);
    this.newsLoading.set(false);
    this.newsSymbol.set('');
    this.newsArticles.set([]);
    this.newsLoadError.set(null);
  }

  /** True when an article's publisher usually requires a paid subscription. */
  isPaywalledArticle(article: FinnhubNewsArticle): boolean {
    return isPaywalledSource(article.source);
  }

  toggleHidePaywalled(): void {
    this.hidePaywalledNews.update(v => !v);
  }

  newsPanelTitleId(): string {
    return `${this.watchlistName().replace(/\s+/g, '-').toLowerCase()}-docs-panel-title`;
  }

  relativeTime(epochSeconds: number): string {
    if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return 'Unknown time';

    const diffMs = Date.now() - (epochSeconds * 1000);
    const absMs = Math.max(0, diffMs);
    const minutes = Math.floor(absMs / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;

    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;

    const years = Math.floor(days / 365);
    return `${years}y ago`;
  }

  private async loadChart(symbol: string, silent = false): Promise<void> {
    if (!silent) {
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, chartLoading: true, chartData: [] } : r
      ));
    }

    const range = this.watchlistRows().find(r => r.symbol === symbol)?.range ?? '1D';
    const config = RANGE_CONFIGS[range];
    const isIntraday = range === '1D' || range === '5D' || range === '1M';

    try {
      const result = await firstValueFrom(
        this.alpacaService.getBars(symbol, config.timeframe, config.getStart(), undefined, range === '1D' ? 5000 : 1000, range === '1D' ? 'desc' : undefined)
      );
      // For 1D we request newest-first (sort=desc) so the latest minute bars are never dropped by
      // the limit (a very liquid symbol can exceed it); restore ascending order for downstream logic.
      const rawBars = range === '1D'
        ? [...(result?.body?.bars ?? [])].reverse()
        : (result?.body?.bars ?? []);
      // For 1D, keep only the two most recent OPEN sessions (data-driven → skips weekends/holidays).
      let bars = rawBars;
      let currentSessionBars = rawBars;
      let sessionShadeUntil: Time | null = null;
      if (range === '1D' && rawBars.length) {
        const dates = Array.from(new Set(rawBars.map(b => etSessionDate(b.t)))).sort();
        const lastTwo = dates.slice(-2);
        const keep = new Set(lastTwo);
        bars = rawBars.filter(b => keep.has(etSessionDate(b.t)));
        const curDate = lastTwo[lastTwo.length - 1];
        currentSessionBars = bars.filter(b => etSessionDate(b.t) === curDate);
        if (lastTwo.length === 2 && currentSessionBars.length) {
          const d = new Date(currentSessionBars[0].t);
          sessionShadeUntil = (Math.floor(d.getTime() / 1000) - d.getTimezoneOffset() * 60) as Time;
        }
      }
      const chartData: LineData<Time>[] = bars.map(bar => {
        if (isIntraday) {
          const barDate = new Date(bar.t);
          const tzOffsetSec = barDate.getTimezoneOffset() * 60;
          return {
            time: (Math.floor(barDate.getTime() / 1000) - tzOffsetSec) as Time,
            value: bar.c
          };
        } else {
          return {
            time: bar.t.split('T')[0] as Time,
            value: bar.c
          };
        }
      });
      // Moving averages counted in bars, so the window scales with the timeframe fidelity
      // (e.g. 20 bars = 20 minutes on 1D, 20 days on 6M). Cumulative until enough bars exist.
      const ma20Data: LineData<Time>[] = [];
      const maData: LineData<Time>[] = [];
      const ma150Data: LineData<Time>[] = [];
      const ma200Data: LineData<Time>[] = [];
      const period20 = 20;
      const period = 50;
      const period150 = 150;
      const period200 = 200;
      if (chartData.length > 0) {
        let sum20 = 0;
        let sum = 0;
        let sum150 = 0;
        let sum200 = 0;
        for (let i = 0; i < chartData.length; i++) {
          sum20 += chartData[i].value;
          sum += chartData[i].value;
          sum150 += chartData[i].value;
          sum200 += chartData[i].value;
          if (i >= period20) {
            sum20 -= chartData[i - period20].value;
            ma20Data.push({ time: chartData[i].time, value: +(sum20 / period20).toFixed(2) });
          } else {
            ma20Data.push({ time: chartData[i].time, value: +(sum20 / (i + 1)).toFixed(2) });
          }

          if (i >= period) {
            sum -= chartData[i - period].value;
            maData.push({ time: chartData[i].time, value: +(sum / period).toFixed(2) });
          } else {
            maData.push({ time: chartData[i].time, value: +(sum / (i + 1)).toFixed(2) });
          }

          if (i >= period150) {
            sum150 -= chartData[i - period150].value;
            ma150Data.push({ time: chartData[i].time, value: +(sum150 / period150).toFixed(2) });
          } else {
            ma150Data.push({ time: chartData[i].time, value: +(sum150 / (i + 1)).toFixed(2) });
          }

          if (i >= period200) {
            sum200 -= chartData[i - period200].value;
            ma200Data.push({ time: chartData[i].time, value: +(sum200 / period200).toFixed(2) });
          } else {
            ma200Data.push({ time: chartData[i].time, value: +(sum200 / (i + 1)).toFixed(2) });
          }
        }
      }
      // Build volume data from bars
      const volumeData: LineData<Time>[] = bars.map((bar, i) => ({
        time: chartData[i].time,
        value: bar.v
      }));
      // Build OHLC candlestick data (used for intraday ranges 1D/5D/1M).
      const candleData: CandlestickData<Time>[] = bars.map((bar, i) => ({
        time: chartData[i].time,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
      }));
      const volumeProfileData = buildVolumeProfile(range === '1D' ? currentSessionBars : bars);
      const rangeLevels = range === '5D' ? buildRangeLevels(bars) : null;
      const openingRange = range === '1D' ? buildOpeningRange(currentSessionBars) : null;
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? {
          ...r,
          chartData,
          candleData,
          chartLoading: false,
          ma20Data,
          maData,
          ma150Data,
          ma200Data,
          volumeData,
          volumeProfileData,
          rangeHigh: rangeLevels?.rangeHigh ?? null,
          rangeLow: rangeLevels?.rangeLow ?? null,
          swingHigh: rangeLevels?.swingHigh ?? null,
          swingLow: rangeLevels?.swingLow ?? null,
          openingRangeHigh: openingRange?.high ?? null,
          openingRangeLow: openingRange?.low ?? null,
          sessionShadeUntil,
        } : r
      ));
      if (this.trailingStops().has(symbol) && chartData.length) {
        this.evaluateTrailingStop(symbol, chartData[chartData.length - 1].value);
      }
      if (this.peerSymbols().has(symbol)) {
        this.loadPeer(symbol);
      }
    } catch {
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, chartLoading: false } : r
      ));
    }
  }
}
