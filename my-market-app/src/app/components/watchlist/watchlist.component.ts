import { Component, OnInit, OnDestroy, computed, signal, inject, input, effect, untracked, HostListener, WritableSignal } from '@angular/core';
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
import { HistoryService } from '../../services/history.service';
import { StopMonitorService, StopMode, LotStopConfig } from '../../services/stop-monitor.service';
import { PLATFORMS, PlatformOption, platformById } from '../../data/platforms';
import { LineData, CandlestickData, HistogramData, Time } from 'lightweight-charts';
import { AppSettingsService } from '../../services/app-settings.service';
import { maColor } from '../../utils/moving-averages';

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
  lotId: string;
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
  chartData: LineData<Time>[];
  candleData: CandlestickData<Time>[];
  chartLoading: boolean;
  volume: number | null;
  maData: Partial<Record<number, LineData<Time>[]>>;
  visibleMas: Set<number>;
  volumeData: HistogramData<Time>[];
  volumeProfileData: VolumeProfileBin[];
  rangeHigh: number | null;
  rangeLow: number | null;
  swingHigh: number | null;
  swingLow: number | null;
  openingRangeHigh: number | null;
  openingRangeLow: number | null;
  sessionShadeUntil: Time | null;
  range: TimeRange;
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
  addedAt: string | null;
  platform: string | null;
  note: string | null;
  cashValue: number | null;
  cashValueLoading: boolean;
  cashValueLoaded: boolean;
  cashValueBreakdown: FinnhubMetrics | null;
}

type SortColumn = 'symbol' | 'name' | 'sector' | 'price' | 'change' | 'changePercent' | 'volume' | 'pegy' | 'dividendYield' | 'costBasis' | 'shares' | 'totalCost' | 'marketValue' | 'gainLoss' | 'gainLossPercent' | 'totalGainLoss' | 'weightPercent';
type SortDirection = 'asc' | 'desc';

type WatchlistEntry = string | { symbol: string; costBasis: number; shares?: number; lotId?: string; addedAt?: string; platform?: string; note?: string };

const HOLDINGS_LIST = 'Current Holdings';

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
  private historyService = inject(HistoryService);
  private stopMonitor = inject(StopMonitorService);
  readonly appSettingsService = inject(AppSettingsService);

  heading = input.required<string>();
  watchlistName = input.required<string>();
  /** When set, each row shows a one-click button that copies its ticker into this other watchlist. */
  copyToListName = input<string | null>(null);
  /** When false, hides the manual add form (e.g. for an auto-managed list like Recommended Picks). */
  allowAdd = input<boolean>(true);

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
  newPlatform = PLATFORMS[0].id;
  adding = signal(false);
  addError = signal<string | null>(null);

  readonly platforms = PLATFORMS;

  hasCostBasis = computed(() => this.watchlistRows().some(r => r.costBasis !== null));

  portfolioTotalCost = computed(() => {
    return this.watchlistRows().reduce((sum, r) => sum + (r.totalCost ?? 0), 0);
  });

  portfolioMarketValue = computed(() => {
    return this.watchlistRows().reduce((sum, r) => sum + (r.marketValue ?? 0), 0);
  });

  portfolioTotalGainLoss = computed(() => {
    return this.portfolioMarketValue() - this.portfolioTotalCost();
  });

  portfolioTotalGains = computed(() => {
    return this.watchlistRows().reduce((sum, row) => sum + Math.max(row.totalGainLoss ?? 0, 0), 0);
  });

  portfolioTotalLosses = computed(() => {
    return this.watchlistRows().reduce((sum, row) => sum + Math.min(row.totalGainLoss ?? 0, 0), 0);
  });

  portfolioTotalGainLossPercent = computed(() => {
    const cost = this.portfolioTotalCost();
    return cost ? +((this.portfolioTotalGainLoss() / cost) * 100).toFixed(2) : 0;
  });

  sortColumn = signal<SortColumn | null>(null);
  sortDirection = signal<SortDirection>('asc');
  expandedLots = signal<Set<string>>(new Set());
  peerSymbols = signal<Set<string>>(new Set());
  macdSymbols = signal<Set<string>>(new Set());
  pollSymbols = signal<Set<string>>(new Set());
  divergenceMap = signal<Map<string, DivergenceType[]>>(new Map());
  private readonly EMPTY_DIV: DivergenceType[] = [];
  fullscreenLot = signal<string | null>(null);
  readonly timeRanges: TimeRange[] = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'All'];
  openingRangeSymbols = signal<Set<string>>(new Set());
  openingRangeNarrowSymbols = signal<Set<string>>(new Set());
  costBasisSymbols = signal<Set<string>>(new Set());
  /** Read-only view of the always-on stop monitor's configs (keyed by lotId). */
  readonly trailingStops = computed(() => this.stopMonitor.stops());
  readonly trailingStopForm = signal<{ lotId: string; symbol: string; price: number } | null>(null);
  readonly tsMode = signal<StopMode>('trailing');
  tsPctInput = '';
  tsLimitInput = '';
  tsExpiryInput = '';
  readonly noteForm = signal<{ lotId: string; symbol: string } | null>(null);
  noteInput = '';
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
      // Current Holdings: Symbol column groups by platform first, then alphabetical.
      if (col === 'symbol' && this.isCurrentHoldings()) {
        const pk = this.platformSortKey(a) - this.platformSortKey(b);
        const cmp = pk !== 0 ? pk : a.symbol.localeCompare(b.symbol);
        return dir === 'asc' ? cmp : -cmp;
      }
      const portfolioCost = col === 'weightPercent' ? this.portfolioTotalCost() : 0;
      const weight = (r: WatchlistRow): number | null =>
        r.totalCost !== null && portfolioCost > 0 ? r.totalCost / portfolioCost : null;
      const aVal = col === 'weightPercent' ? weight(a) : a[col];
      const bVal = col === 'weightPercent' ? weight(b) : b[col];
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
      const ready = this.initialized();
      untracked(() => {
        if (!ready) return;
        const entries = this.watchlistService.getEntries(this.watchlistName());
        const storageSymbols = new Set(entries.map(e => (typeof e === 'string' ? e : e.symbol).toUpperCase()));
        // Prune rows no longer in storage (lets another component REPLACE this list);
        // skip Current Holdings, which is lot-based and edited only locally.
        if (!this.isCurrentHoldings()) {
          for (const row of this.watchlistRows().filter(r => !storageSymbols.has(r.symbol))) {
            this.removeLot(row);
          }
        }
        const current = this.symbols();
        for (const sym of storageSymbols) {
          if (!current.includes(sym)) {
            this.addTicker(sym);
          }
        }
      });
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
    this.newPlatform = PLATFORMS[0].id;
    this.addError.set(null);
  }

  isCurrentHoldings(): boolean {
    return this.watchlistName().toLowerCase() === 'current holdings';
  }

  /** This holding's total cost as a percent of the whole portfolio's cost — i.e. its
   *  allocation weight. Weights across all rows sum to 100%. Null when portfolio cost is 0. */
  weightPercent(row: WatchlistRow): number | null {
    const totalCost = this.portfolioTotalCost();
    if (row.totalCost === null || totalCost <= 0) return null;
    return +((row.totalCost / totalCost) * 100).toFixed(2);
  }

  /** Today as YYYY-MM-DD (local), used to cap the Date Bought picker (no future buys). */
  todayIso(): string {
    return new Date().toLocaleDateString('en-CA');
  }

  /** A lot's addedAt as YYYY-MM-DD (local) to prefill the Date Bought picker; '' when unset. */
  addedAtInputValue(row: WatchlistRow): string {
    return row.addedAt ? new Date(row.addedAt).toLocaleDateString('en-CA') : '';
  }

  /** Lots whose Date Bought is currently being edited (picker shown beside a set value). */
  editingDateLots = signal<Set<string>>(new Set());

  isEditingDateBought(lotId: string): boolean {
    return this.editingDateLots().has(lotId);
  }

  startEditDateBought(lotId: string): void {
    this.editingDateLots.update(s => new Set(s).add(lotId));
  }

  /** Records a lot's actual buy date from the inline picker (shown when addedAt is unset or being edited). */
  setDateBought(row: WatchlistRow, value: string): void {
    if (!value) return;
    this.patchRow(row.lotId, { addedAt: new Date(`${value}T12:00:00`).toISOString() });
    this.editingDateLots.update(s => { const next = new Set(s); next.delete(row.lotId); return next; });
    this.saveToStorage();
  }

  /** Platform metadata for a lot's stored id (null when unset or unknown). */
  platformFor(id: string | null): PlatformOption | null {
    return platformById(id);
  }

  /** Symbol text color for a holding's platform (null → default styling). */
  symbolColor(row: WatchlistRow): string | null {
    return this.platformFor(row.platform)?.color ?? null;
  }

  /** Platform of the matching Current Holdings lot, for tickers watched on another list. */
  heldPlatform(symbol: string): PlatformOption | null {
    this.watchlistService.version(HOLDINGS_LIST)(); // reactive dependency
    return platformById(this.watchlistService.getPlatform(HOLDINGS_LIST, symbol));
  }

  /** Symbol text color for a watched ticker that is also a current holding (null → default). */
  watchedSymbolColor(symbol: string): string | null {
    return this.heldPlatform(symbol)?.color ?? null;
  }

  /** Tooltip flagging a watched ticker that is already held ('' when it is not). */
  watchedSymbolTitle(symbol: string): string {
    const platform = this.heldPlatform(symbol);
    return platform ? `Also held at ${platform.label}` : '';
  }

  /** Platform ordering key for the Symbol sort (unset lots sort last). */
  private platformSortKey(row: WatchlistRow): number {
    const idx = this.platforms.findIndex(p => p.id === row.platform);
    return idx === -1 ? this.platforms.length : idx;
  }

  /** Lots whose platform is currently being edited (inline dropdown shown). */
  editingPlatformLots = signal<Set<string>>(new Set());

  isEditingPlatform(lotId: string): boolean {
    return this.editingPlatformLots().has(lotId);
  }

  startEditPlatform(lotId: string): void {
    this.editingPlatformLots.update(s => new Set(s).add(lotId));
  }

  /** Assigns (or clears) a lot's platform from the inline dropdown. */
  setPlatform(row: WatchlistRow, id: string): void {
    this.patchRow(row.lotId, { platform: id || null });
    this.editingPlatformLots.update(s => { const next = new Set(s); next.delete(row.lotId); return next; });
    this.saveToStorage();
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

  private loadFromStorage(): WatchlistEntry[] | null {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** Serializes the current rows to storage entries (one entry per lot; a lot per row). */
  private buildEntries(): WatchlistEntry[] {
    return this.watchlistRows().map(r => {
      if (r.costBasis != null) {
        const entry: { symbol: string; costBasis: number; shares?: number; lotId: string; addedAt?: string; platform?: string; note?: string } = { symbol: r.symbol, costBasis: r.costBasis, lotId: r.lotId };
        if (r.shares != null) entry.shares = r.shares;
        if (r.addedAt != null) entry.addedAt = r.addedAt;
        if (r.platform != null) entry.platform = r.platform;
        if (r.note) entry.note = r.note;
        return entry;
      }
      return r.symbol;
    });
  }

  private saveToStorage(): void {
    localStorage.setItem(this.storageKey, JSON.stringify(this.buildEntries()));
  }

  async loadWatchlist(): Promise<void> {
    this.loading.set(true);
    try {
      let rawEntries: WatchlistEntry[] | null = this.loadFromStorage();

      if (!rawEntries) {
        rawEntries = [];
      }

      // Each entry is a lot; the same symbol may appear more than once (different cost/share).
      const lots = rawEntries.map(entry => typeof entry === 'string'
        ? { lotId: entry, symbol: entry, costBasis: null as number | null, shares: null as number | null, addedAt: null as string | null, platform: null as string | null, note: null as string | null }
        : { lotId: entry.lotId ?? crypto.randomUUID(), symbol: entry.symbol, costBasis: entry.costBasis, shares: entry.shares ?? null, addedAt: entry.addedAt ?? null, platform: entry.platform ?? null, note: entry.note ?? null });
      const uniqueSymbols = [...new Set(lots.map(l => l.symbol))];
      this.symbols.set(uniqueSymbols);

      if (!lots.length) {
        this.watchlistRows.set([]);
        return;
      }

      const uncachedSymbols = uniqueSymbols.filter(s => !this.fmpService.hasProfile(s));
      if (uncachedSymbols.length) {
        try {
          await firstValueFrom(this.fmpService.getProfiles(uncachedSymbols));
        } catch {
          // continue without sector data
        }
      }

      const snapResult = await this.fetchSnapshots(uniqueSymbols);
      if (!snapResult.okRes?.body) return;

      const snapshots = snapResult.okRes.body;
      const rows: WatchlistRow[] = lots.map(lot => {
        const symbol = lot.symbol;
        const snap: AlpacaSnapshot | undefined = snapshots[symbol];
        const name = this.fmpService.getCachedCompanyName(symbol) ?? symbol;
        const price = snap?.latestTrade?.p ?? snap?.minuteBar?.c ?? null;
        const prevClose = snap?.prevDailyBar?.c ?? null;
        const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
        const changePercent = price && prevClose ? +((change! / prevClose) * 100).toFixed(2) : null;
        const sector = this.fmpService.getCachedSector(symbol) ?? '\u2014';
        const costBasis = lot.costBasis;
        const shares = lot.shares;
        const totalCost = costBasis !== null && shares !== null ? +(costBasis * shares).toFixed(2) : null;
        const marketValue = price !== null && shares !== null ? +(price * shares).toFixed(2) : null;
        const gainLoss = price !== null && costBasis !== null ? +(price - costBasis).toFixed(2) : null;
        const gainLossPercent = gainLoss !== null && costBasis !== null ? +((gainLoss / costBasis) * 100).toFixed(2) : null;
        const totalGainLoss = marketValue !== null && totalCost !== null ? +(marketValue - totalCost).toFixed(2) : null;
        const volume = snap?.dailyBar?.v ?? null;
        return { lotId: lot.lotId, symbol, name, sector, price, change, changePercent, pegy: null, pegyLoading: false, pegyLoaded: false, dividendYield: this.#dividendYield(symbol, price), volume, costBasis, shares, totalCost, marketValue, gainLoss, gainLossPercent, totalGainLoss, chartData: [], candleData: [], chartLoading: false, maData: {}, visibleMas: new Set(), volumeData: [], volumeProfileData: [], rangeHigh: null, rangeLow: null, swingHigh: null, swingLow: null, openingRangeHigh: null, openingRangeLow: null, sessionShadeUntil: null, range: '1D', showRangeLevels: false, peerSymbol: null, peerName: null, peerData: [], peerLoading: false, metrics: null, metricsLoading: false, recommendation: null, recommendationLoading: false, nextEarnings: null, nextEarningsLoaded: false, earningsSurprises: null, addedAt: lot.addedAt, platform: lot.platform, note: lot.note, cashValue: null, cashValueLoading: false, cashValueLoaded: false, cashValueBreakdown: null };
      });
      this.watchlistRows.set(rows);
      this.saveToStorage();
      this.prefetchEarningsDates();
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
    return { lotId: symbol, symbol, name, sector, price, change, changePercent, pegy: null, pegyLoading: false, pegyLoaded: false, dividendYield: this.#dividendYield(symbol, price), volume, costBasis, shares, totalCost, marketValue, gainLoss, gainLossPercent, totalGainLoss, chartData: [], candleData: [], chartLoading: false, maData: {}, visibleMas: new Set(), volumeData: [], volumeProfileData: [], rangeHigh: null, rangeLow: null, swingHigh: null, swingLow: null, openingRangeHigh: null, openingRangeLow: null, sessionShadeUntil: null, range: '1D', showRangeLevels: false, peerSymbol: null, peerName: null, peerData: [], peerLoading: false, metrics: null, metricsLoading: false, recommendation: null, recommendationLoading: false, nextEarnings: null, nextEarningsLoaded: false, earningsSurprises: null, addedAt: null, platform: null, note: null, cashValue: null, cashValueLoading: false, cashValueLoaded: false, cashValueBreakdown: null };
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
      this.prefetchEarningsDates();
    } catch {
      // network/profile errors are non-fatal; the ticker simply isn't added
    }
  }

  hasSymbol(symbol: string): boolean {
    return this.symbols().includes(symbol.trim().toUpperCase());
  }

  /** Moves a row's ticker into the `copyToListName` watchlist and removes it from this list. */
  moveToList(row: WatchlistRow): void {
    const name = this.copyToListName();
    if (!name) return;
    this.watchlistService.addSymbol(name, row.symbol);
    this.removeLot(row);
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
    const parsedCost = Number(this.newCostBasis);
    const shares = requiresHoldingInputs ? +parsedShares.toFixed(4) : null;
    const costBasis = requiresHoldingInputs
      ? parsedCost / shares!
      : null;
    if (requiresHoldingInputs) {
      if (!Number.isFinite(parsedShares) || parsedShares <= 0) {
        const msg = 'Enter a valid share quantity greater than 0.';
        this.addError.set(msg);
        this.notificationService.showError(msg);
        return;
      }
      if (!Number.isFinite(parsedCost) || parsedCost <= 0) {
        const msg = 'Enter a valid total cost basis greater than 0.';
        this.addError.set(msg);
        this.notificationService.showError(msg);
        return;
      }
    }

    if (requiresHoldingInputs) {
      // Holdings may hold the same ticker across multiple lots; reject only an exact cost/share duplicate.
      const normalizedCostBasis = costBasis !== null
        ? costBasis
        : null;
      const duplicateLot = this.watchlistRows().some(r => r.symbol === symbol && r.costBasis === normalizedCostBasis);
      if (duplicateLot) {
        const msg = `${symbol} at $${normalizedCostBasis?.toFixed(2)}/share is already a lot \u2014 use a different cost/share.`;
        this.addError.set(msg);
        this.notificationService.showError(msg);
        return;
      }
    } else if (this.symbols().includes(symbol)) {
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
      const normalizedCostBasis = costBasis !== null
        ? costBasis
        : null;
      const totalCost = normalizedCostBasis !== null && shares !== null ? +(normalizedCostBasis * shares).toFixed(2) : null;
      const marketValue = price !== null && shares !== null ? +(price * shares).toFixed(2) : null;
      const gainLoss = price !== null && normalizedCostBasis !== null ? +(price - normalizedCostBasis).toFixed(2) : null;
      const gainLossPercent = gainLoss !== null && normalizedCostBasis !== null
        ? +((gainLoss / normalizedCostBasis) * 100).toFixed(2)
        : null;
      const totalGainLoss = marketValue !== null && totalCost !== null ? +(marketValue - totalCost).toFixed(2) : null;

      this.symbols.update(s => s.includes(symbol) ? s : [...s, symbol]);
      this.watchlistRows.update(rows => [...rows, {
        lotId: crypto.randomUUID(),
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
        shares,
        totalCost,
        marketValue,
        gainLoss,
        gainLossPercent,
        totalGainLoss,
        chartData: [],
        candleData: [],
        chartLoading: false,
        maData: {},
        visibleMas: new Set(),
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
        addedAt: new Date().toISOString(),
        platform: requiresHoldingInputs ? this.newPlatform : null,
        note: null,
        cashValue: null,
        cashValueLoading: false,
        cashValueLoaded: false,
        cashValueBreakdown: null,
      }]);
      this.clearInput();
      this.saveToStorage();
      this.prefetchEarningsDates();
    } finally {
      this.adding.set(false);
    }
  }

  removeLot(row: WatchlistRow): void {
    const { lotId, symbol } = row;
    // Log a realized-gains record when a real holding lot is sold off the Current Holdings list.
    if (this.isCurrentHoldings() && row.costBasis !== null) {
      this.historyService.addRecord({
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        shares: row.shares,
        costBasis: row.costBasis,
        totalCost: row.totalCost,
        sellPrice: row.price,
        proceeds: row.marketValue,
        gainLoss: row.gainLoss,
        gainLossPercent: row.gainLossPercent,
        totalGainLoss: row.totalGainLoss,
        addedAt: row.addedAt,
      });
    }
    this.watchlistRows.update(rows => rows.filter(r => r.lotId !== lotId));
    this.expandedLots.update(s => { const next = new Set(s); next.delete(lotId); return next; });
    if (this.fullscreenLot() === lotId) this.fullscreenLot.set(null);
    // Clear this lot's per-lot chart state.
    this.peerSymbols.update(s => { const next = new Set(s); next.delete(lotId); return next; });
    this.macdSymbols.update(s => { const next = new Set(s); next.delete(lotId); return next; });
    this.pollSymbols.update(s => { const next = new Set(s); next.delete(lotId); return next; });
    this.costBasisSymbols.update(s => { const next = new Set(s); next.delete(lotId); return next; });
    this.openingRangeSymbols.update(s => { const next = new Set(s); next.delete(lotId); return next; });
    this.openingRangeNarrowSymbols.update(s => { const next = new Set(s); next.delete(lotId); return next; });
    this.divergenceMap.update(m => { const next = new Map(m); next.delete(lotId); return next; });
    this.stopMonitor.remove(lotId);
    // Drop the symbol from the API dedup list once no lots of it remain.
    if (!this.watchlistRows().some(r => r.symbol === symbol)) {
      this.symbols.update(s => s.filter(sym => sym !== symbol));
    }
    this.saveToStorage();
  }

  isExpanded(lotId: string): boolean {
    return this.expandedLots().has(lotId);
  }

  /** Expands a single lot (if not already) and loads its chart plus the symbol's shared fundamentals. */
  private ensureLotExpanded(row: WatchlistRow): void {
    if (this.expandedLots().has(row.lotId)) return;
    this.expandedLots.update(s => new Set(s).add(row.lotId));
    this.loadChart(row.lotId);
    this.loadMetrics(row.symbol);
    this.loadRecommendation(row.symbol);
    this.loadEarnings(row.symbol);
  }

  toggleChart(row: WatchlistRow): void {
    const { lotId, symbol } = row;
    if (this.expandedLots().has(lotId)) {
      this.expandedLots.update(s => { const next = new Set(s); next.delete(lotId); return next; });
    } else {
      this.expandedLots.update(s => new Set(s).add(lotId));
      this.loadChart(lotId);
      this.loadMetrics(symbol);
      this.loadRecommendation(symbol);
      this.loadEarnings(symbol);
    }
  }

  private async loadMetrics(symbol: string): Promise<void> {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    if (!row || row.metrics || row.metricsLoading) return;
    this.patchSymbol(symbol, { metricsLoading: true });
    try {
      const metrics = await firstValueFrom(this.finnhubService.getBasicFinancials(symbol));
      this.patchSymbol(symbol, { metrics: metrics ?? null, metricsLoading: false });
    } catch {
      this.patchSymbol(symbol, { metricsLoading: false });
    }
  }

  private async loadRecommendation(symbol: string): Promise<void> {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    if (!row || row.recommendation || row.recommendationLoading) return;
    this.patchSymbol(symbol, { recommendationLoading: true });
    try {
      const trends = await firstValueFrom(this.finnhubService.getRecommendationTrends(symbol));
      this.patchSymbol(symbol, { recommendation: trends?.[0] ?? null, recommendationLoading: false });
    } catch {
      this.patchSymbol(symbol, { recommendationLoading: false });
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
      this.patchSymbol(symbol, { nextEarnings: next, earningsSurprises: surprises ?? null, nextEarningsLoaded: true });
    } catch {
      this.patchSymbol(symbol, { nextEarningsLoaded: true });
    }
  }

  /** Prefetches just the next-earnings date for every row so rows can shade as earnings approach
   *  (full earnings incl. surprises still load lazily on chart expand). Best-effort, sequential to be quota-friendly. */
  private async prefetchEarningsDates(): Promise<void> {
    const symbols = [...new Set(this.watchlistRows().map(r => r.symbol))];
    for (const symbol of symbols) {
      const row = this.watchlistRows().find(r => r.symbol === symbol);
      if (!row || row.nextEarnings || row.nextEarningsLoaded) continue;
      try {
        const next = await firstValueFrom(this.finnhubService.getNextEarnings(symbol));
        if (next) this.patchSymbol(symbol, { nextEarnings: next });
      } catch {
        // no shading if the date can't be fetched
      }
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

  /** Row shading class as earnings approach (empty when >3 days out or unknown); brighter the closer the day. */
  earningsRowClass(row: WatchlistRow): string {
    const days = this.daysUntilEarnings(row);
    if (days === null || days > 3) return '';
    return `earnings-near earnings-d${days}`;
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

  readonly pegyTooltip = 'PEGY = P/E ÷ (EPS growth % + dividend yield %)\n\nGrowth is implied from Finnhub PEG (P/E ÷ PEG), falling back to 5-year EPS growth.\nUnder 1 is the classic Lynch buy zone (green), 1–2 is fair, over 2 is expensive (red).';

  async loadPegy(symbol: string): Promise<void> {
    this.watchlistRows.update(rows => rows.map(r =>
      r.symbol === symbol ? { ...r, pegyLoading: true } : r
    ));
    try {
      const metrics = await firstValueFrom(this.finnhubService.getBasicFinancials(symbol));
      const pegy = this.isEtf(symbol) ? null : this.#pegyFrom(metrics);
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, pegy, metrics: r.metrics ?? metrics, pegyLoaded: true, pegyLoading: false } : r
      ));
    } catch {
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, pegyLoading: false } : r
      ));
    }
  }

  /** Growth rate behind PEGY: implied by Finnhub's PEG, else the 5-year EPS growth rate. */
  #pegyGrowth(m: FinnhubMetrics): number | null {
    if (m.pegTTM !== null && m.pegTTM > 0 && m.peTTM !== null) return m.peTTM / m.pegTTM;
    return m.epsGrowth5Y;
  }

  #pegyFrom(m: FinnhubMetrics | null): number | null {
    if (!m || m.peTTM === null || m.peTTM <= 0) return null;
    const growth = this.#pegyGrowth(m);
    if (growth === null) return null;
    const denominator = growth + (m.dividendYield ?? 0);
    if (denominator <= 0) return null;
    return +(m.peTTM / denominator).toFixed(3);
  }

  /** Multi-line tooltip showing the PEGY formula with this row's inputs. */
  pegyTitle(row: WatchlistRow): string {
    const m = row.metrics;
    if (!m || row.pegy === null) return this.pegyTooltip;
    const growth = this.#pegyGrowth(m);
    const pct = (v: number | null) => v === null ? 'N/A' : `${v.toFixed(2)}%`;
    return [
      'PEGY = P/E ÷ (EPS growth % + dividend yield %)',
      `     = ${m.peTTM?.toFixed(2) ?? 'N/A'} ÷ (${pct(growth)} + ${pct(m.dividendYield)})`,
      `     = ${row.pegy.toFixed(3)}`,
      '',
      `PEG (TTM) = ${m.pegTTM?.toFixed(2) ?? 'N/A'}`,
      'Under 1 is the classic Lynch buy zone; over 2 is expensive.',
    ].join('\n');
  }

  readonly cashValueTooltip = 'EV/FCF — years of free cash flow needed to pay back the purchase price.\n\nEV = market cap + total debt − cash on hand\nEV/FCF = EV ÷ trailing-twelve-month free cash flow\n\nLower is cheaper: under 15y is attractive, over 30y is expensive.\nN/A when free cash flow is zero or negative.';

  /** Lazily fetches the EV/FCF payback metric for a symbol (shares Finnhub's 12h metrics cache). */
  async loadCashValue(symbol: string): Promise<void> {
    this.watchlistRows.update(rows => rows.map(r =>
      r.symbol === symbol ? { ...r, cashValueLoading: true } : r
    ));
    try {
      const result = await firstValueFrom(this.finnhubService.getBasicFinancials(symbol));
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol
          ? { ...r, cashValue: result?.evFcfTTM ?? null, cashValueBreakdown: result ?? null, cashValueLoaded: true, cashValueLoading: false }
          : r
      ));
    } catch {
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, cashValueLoading: false } : r
      ));
    }
  }

  /** Compact dollar formatting (e.g. -$1.24B) for the cash-value cell/tooltip. */
  formatCompactMoney(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return 'N/A';
    const sign = v < 0 ? '\u2212' : '';
    const abs = Math.abs(v);
    if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  }

  /** EV/FCF rendered as a payback period, e.g. "7.2y". */
  formatEvToOcf(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return 'N/A';
    return `${v.toFixed(1)}y`;
  }

  /** Multi-line tooltip showing the formula and this row's inputs (falls back to the generic help text). */
  cashValueTitle(row: WatchlistRow): string {
    const b = row.cashValueBreakdown;
    if (!b) return this.cashValueTooltip;
    // Finnhub reports market cap and enterprise value in millions.
    const money = (millions: number | null) => this.formatCompactMoney(millions === null ? null : millions * 1e6);
    const netDebt = b.enterpriseValue !== null && b.marketCap !== null ? b.enterpriseValue - b.marketCap : null;
    return [
      'EV = market cap + total debt − cash',
      `   = ${money(b.marketCap)} + ${money(netDebt)} (net debt)`,
      `   = ${money(b.enterpriseValue)}`,
      '',
      'EV/FCF = EV ÷ free cash flow (TTM)',
      `       = ${this.formatEvToOcf(b.evFcfTTM)}`,
      `EV/FCF (annual) = ${this.formatEvToOcf(b.evFcfAnnual)}`,
      `EV/EBITDA = ${b.evEbitdaTTM !== null ? b.evEbitdaTTM.toFixed(1) : 'N/A'}`,
      '',
      'Lower EV/FCF is cheaper (<15y attractive, >30y expensive).',
    ].join('\n');
  }

  toggleMacd(lotId: string): void {
    this.macdSymbols.update(s => {
      const next = new Set(s);
      if (next.has(lotId)) next.delete(lotId); else next.add(lotId);
      return next;
    });
  }

  togglePoll(lotId: string): void {
    this.pollSymbols.update(s => {
      const next = new Set(s);
      if (next.has(lotId)) next.delete(lotId); else next.add(lotId);
      return next;
    });
  }

  /** Silently refreshes any polled + expanded 1D CHARTS (row data is left to the 15-min refresh), but only while the market is open. */
  private async pollTick(): Promise<void> {
    const lotIds = [...this.pollSymbols()].filter(id => this.isExpanded(id) && this.rangeFor(id) === '1D');
    if (!lotIds.length) return;
    try {
      const clock = await firstValueFrom(this.alpacaService.getClock());
      if (!clock?.body?.is_open) return;
    } catch {
      return;
    }
    for (const lotId of lotIds) {
      this.loadChart(lotId, true);
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
      const dividendYield = this.#dividendYield(r.symbol, price);
      return { ...r, price, change, changePercent, volume, marketValue, gainLoss, gainLossPercent, totalGainLoss, dividendYield };
    }));
  }

  divergencesFor(lotId: string): DivergenceType[] {
    return this.divergenceMap().get(lotId) ?? this.EMPTY_DIV;
  }

  hasDivergence(lotId: string, type: DivergenceType): boolean {
    return this.divergencesFor(lotId).includes(type);
  }

  toggleDivergence(lotId: string, type: DivergenceType): void {
    this.divergenceMap.update(m => {
      const next = new Map(m);
      const cur = new Set(next.get(lotId) ?? []);
      if (cur.has(type)) cur.delete(type); else cur.add(type);
      if (cur.size) next.set(lotId, [...cur]); else next.delete(lotId);
      return next;
    });
  }

  togglePeer(lotId: string): void {
    const row = this.watchlistRows().find(r => r.lotId === lotId);
    if (!row) return;
    if (this.peerSymbols().has(lotId)) {
      this.peerSymbols.update(s => { const next = new Set(s); next.delete(lotId); return next; });
      this.patchRow(lotId, { peerData: [] });
      return;
    }
    this.peerSymbols.update(s => new Set(s).add(lotId));
    if (this.isExpanded(lotId)) {
      this.loadPeer(lotId);
    } else {
      this.ensureLotExpanded(row);
    }
  }

  private async loadPeer(lotId: string): Promise<void> {
    const row = this.watchlistRows().find(r => r.lotId === lotId);
    const mainData = row?.chartData ?? [];
    if (!row || !mainData.length) return;
    const symbol = row.symbol;

    this.watchlistRows.update(rows => rows.map(r =>
      r.lotId === lotId ? { ...r, peerLoading: true, peerData: [] } : r
    ));

    const range = row?.range ?? '1D';
    const config = RANGE_CONFIGS[range];
    const isIntraday = range === '1D' || range === '5D' || range === '1M';

    try {
      const peerSymbol = await firstValueFrom(this.fmpService.getClosestPeer(symbol));
      if (!peerSymbol) {
        console.warn(`No peer found for ${symbol}.`);
        this.watchlistRows.update(rows => rows.map(r =>
          r.lotId === lotId ? { ...r, peerSymbol: null, peerName: null, peerData: [], peerLoading: false } : r
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
          r.lotId === lotId ? { ...r, peerSymbol, peerName, peerData: [], peerLoading: false } : r
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
        r.lotId === lotId ? { ...r, peerSymbol, peerName, peerData, peerLoading: false } : r
      ));
    } catch {
      this.watchlistRows.update(rows => rows.map(r =>
        r.lotId === lotId ? { ...r, peerLoading: false } : r
      ));
    }
  }

  /** Patches a single lot's row (by lotId). */
  private patchRow(lotId: string, patch: Partial<WatchlistRow>): void {
    this.watchlistRows.update(rows => rows.map(r => r.lotId === lotId ? { ...r, ...patch } : r));
  }

  /** Patches every row of a symbol — used for symbol-level shared data (fundamentals). */
  private patchSymbol(symbol: string, patch: Partial<WatchlistRow>): void {
    this.watchlistRows.update(rows => rows.map(r => r.symbol === symbol ? { ...r, ...patch } : r));
  }

  private rangeFor(lotId: string): TimeRange {
    return this.watchlistRows().find(r => r.lotId === lotId)?.range ?? '1D';
  }

  selectRange(lotId: string, range: TimeRange): void {
    const patch: Partial<WatchlistRow> = { range };
    if (range !== '5D' && range !== '1D') patch.showRangeLevels = false;
    this.patchRow(lotId, patch);
    this.loadChart(lotId);
  }

  toggleRangeLevels(lotId: string): void {
    const row = this.watchlistRows().find(r => r.lotId === lotId);
    if (!row || (row.range !== '5D' && row.range !== '1D')) return;
    this.patchRow(lotId, { showRangeLevels: !row.showRangeLevels });
  }

  toggleFullscreen(row: WatchlistRow): void {
    const lotId = row.lotId;
    this.fullscreenLot.update(cur => cur === lotId ? null : lotId);
  }

  @HostListener('document:keydown.escape')
  closeFullscreen(): void {
    if (this.fullscreenLot() !== null) this.fullscreenLot.set(null);
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

  toggleOpeningRange(lotId: string): void {
    if (this.rangeFor(lotId) !== '1D') return;
    this.openingRangeSymbols.update(s => {
      const next = new Set(s);
      if (next.has(lotId)) next.delete(lotId); else next.add(lotId);
      return next;
    });
  }

  toggleOpeningRangeNarrow(lotId: string): void {
    if (this.rangeFor(lotId) !== '1D') return;
    this.openingRangeNarrowSymbols.update(s => {
      const next = new Set(s);
      if (next.has(lotId)) next.delete(lotId); else next.add(lotId);
      return next;
    });
  }

  private narrowedBound(row: WatchlistRow, bound: 'high' | 'low'): number | null {
    const high = row.openingRangeHigh;
    const low = row.openingRangeLow;
    const raw = bound === 'high' ? high : low;
    if (high === null || low === null) return raw;
    if (!this.openingRangeNarrowSymbols().has(row.lotId)) return raw;
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

  toggleMa(lotId: string, period: number): void {
    const row = this.watchlistRows().find(r => r.lotId === lotId);
    if (!row) return;
    const next = new Set(row.visibleMas);
    if (next.has(period)) next.delete(period); else next.add(period);
    this.patchRow(lotId, { visibleMas: next });
  }

  maColor(period: number): string {
    return maColor(period);
  }

  maSeriesFor(row: WatchlistRow): { period: number; data: LineData<Time>[] }[] {
    return [...row.visibleMas]
      .map(period => ({ period, data: row.maData[period] ?? [] }))
      .filter(m => m.data.length > 0);
  }

  toggleCostBasis(lotId: string): void {
    this.costBasisSymbols.update(s => {
      const next = new Set(s);
      if (next.has(lotId)) next.delete(lotId); else next.add(lotId);
      return next;
    });
  }

  /** Current computed trailing stop level for a lot (null if none set). */
  trailingStopLevel(lotId: string): number | null {
    return this.trailingStops().get(lotId)?.stop ?? null;
  }

  /** Expiry (epoch ms) of a lot's trailing stop (null if none set). */
  trailingStopExpiry(lotId: string): number | null {
    return this.trailingStops().get(lotId)?.expiry ?? null;
  }

  /** Trailing stop percentage for a lot (null if none set). */
  trailingStopPct(lotId: string): number | null {
    return this.trailingStops().get(lotId)?.pct ?? null;
  }

  /** Alert mode for a lot (null if none set). */
  trailingStopMode(lotId: string): StopMode | null {
    return this.trailingStops().get(lotId)?.mode ?? null;
  }

  /** Button/chart label reflecting the configured alert type. */
  trailingStopLabel(lotId: string): string {
    return this.trailingStopMode(lotId) === 'limit' ? 'Limit' : 'Trailing Stop';
  }

  /** Whether a lot's stop/limit has fired (badge shown until dismissed). */
  trailingStopTriggered(lotId: string): boolean {
    return this.trailingStops().get(lotId)?.status === 'triggered';
  }

  /** Whether a fired lot was an upside limit target (green) vs a downside stop (red). */
  trailingStopHitUp(lotId: string): boolean {
    const cfg = this.trailingStops().get(lotId);
    return cfg?.mode === 'limit' && cfg.above === true;
  }

  /** Short badge label for a fired lot. */
  stopBadgeLabel(lotId: string): string {
    return this.trailingStopHitUp(lotId) ? 'TARGET HIT' : 'STOP HIT';
  }

  /** Row shading class when a stop/limit has fired. */
  stopRowClass(lotId: string): string {
    if (!this.trailingStopTriggered(lotId)) return '';
    return this.trailingStopHitUp(lotId) ? 'stop-hit-row stop-hit-row--up' : 'stop-hit-row';
  }

  /** 'up'/'down' when a lot's live price is within the warn band of its (not-yet-hit) level; else null. */
  stopApproaching(row: WatchlistRow): 'up' | 'down' | null {
    const cfg = this.trailingStops().get(row.lotId);
    if (!cfg || row.price === null) return null;
    return this.stopMonitor.approachingDirection(cfg, row.price);
  }

  /** Opens the note editor for a lot, prefilled with any existing note. */
  openNote(row: WatchlistRow): void {
    this.noteInput = row.note ?? '';
    this.noteForm.set({ lotId: row.lotId, symbol: row.symbol });
  }

  cancelNote(): void {
    this.noteForm.set(null);
  }

  /** Saves the note (blank clears it) and persists. */
  saveNote(): void {
    const form = this.noteForm();
    if (!form) return;
    const note = this.noteInput.trim();
    this.patchRow(form.lotId, { note: note || null });
    this.noteForm.set(null);
    this.saveToStorage();
  }

  /**
   * Remaining room before a lot's stop/limit fires: the gap as a % of price, plus that gap as a
   * share of the original distance (so the gauge empties as price closes in). Null when not applicable.
   */
  private stopGap(row: WatchlistRow): { pct: number; fraction: number; up: boolean } | null {
    const cfg = this.trailingStops().get(row.lotId);
    if (!cfg || cfg.status === 'triggered' || row.price === null || row.price <= 0 || cfg.stop <= 0) return null;
    const up = cfg.mode === 'limit' && cfg.above;
    const gap = up ? cfg.stop - row.price : row.price - cfg.stop;
    if (gap < 0) return null;
    const pct = (gap / row.price) * 100;
    // Trailing stops sit a fixed % below the peak; limits keep their distance from the price when set.
    const maxPct = cfg.mode === 'trailing'
      ? cfg.pct
      : (cfg.peak > 0 ? (Math.abs(cfg.stop - cfg.peak) / cfg.peak) * 100 : pct);
    const fraction = maxPct > 0 ? Math.min(1, Math.max(0, pct / maxPct)) : 0;
    return { pct, fraction, up };
  }

  /** Gap to the stop/limit as a percent of price (null when no active alert). */
  stopGapPct(row: WatchlistRow): number | null {
    return this.stopGap(row)?.pct ?? null;
  }

  /** Gap as a 0–1 share of the original distance, driving the gauge fill height. */
  stopGapFraction(row: WatchlistRow): number | null {
    return this.stopGap(row)?.fraction ?? null;
  }

  /** True when the level is an upside limit target rather than a downside stop. */
  stopGapUp(row: WatchlistRow): boolean {
    return this.stopGap(row)?.up ?? false;
  }

  /** Gauge tint: danger once inside the warn band or the last fifth of the range, warn past the halfway mark. */
  stopGapSeverity(row: WatchlistRow): 'safe' | 'warn' | 'danger' | null {
    const gap = this.stopGap(row);
    if (!gap) return null;
    if (this.stopApproaching(row) !== null || gap.fraction <= 0.2) return 'danger';
    return gap.fraction <= 0.5 ? 'warn' : 'safe';
  }

  /** Tooltip describing how and when a lot's alert fired. */
  stopHitTooltip(lotId: string): string {
    const cfg = this.trailingStops().get(lotId);
    if (!cfg || cfg.status !== 'triggered') return '';
    const level = cfg.stop.toFixed(2);
    const kind = cfg.mode === 'limit' ? `limit $${level}` : `${cfg.pct}% trailing stop ($${level})`;
    const at = cfg.triggerPrice != null ? ` at $${cfg.triggerPrice.toFixed(2)}` : '';
    const when = cfg.triggeredAt ? ` on ${new Date(cfg.triggeredAt).toLocaleDateString('en-CA')}` : '';
    return `Hit ${kind}${at}${when} — click to dismiss`;
  }

  /** Clears a fired stop/limit badge for a lot. */
  dismissTrailingStop(lotId: string): void {
    this.stopMonitor.remove(lotId);
  }

  /** Prompts (via a modal with a calendar) for a trailing stop percentage and expiry, or clears an existing one. */
  toggleTrailingStop(lotId: string): void {
    if (this.trailingStops().has(lotId)) {
      this.stopMonitor.remove(lotId);
      return;
    }
    const row = this.watchlistRows().find(r => r.lotId === lotId);
    const price = row?.price ?? (row?.chartData.length ? row.chartData[row.chartData.length - 1].value : null);
    if (!row || price === null || price === undefined) {
      this.notificationService.showError('Current price unavailable; cannot set a trailing stop.');
      return;
    }
    this.tsMode.set('trailing');
    this.tsPctInput = '';
    this.tsLimitInput = price.toFixed(2);
    this.tsExpiryInput = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-CA');
    this.trailingStopForm.set({ lotId, symbol: row.symbol, price });
  }

  /** Earliest selectable expiry (tomorrow) for the date picker. */
  minExpiryDate(): string {
    return new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA');
  }

  cancelTrailingStop(): void {
    this.trailingStopForm.set(null);
  }

  /** Validates the modal inputs and creates the persisted trailing stop or limit alert. */
  confirmTrailingStop(): void {
    const form = this.trailingStopForm();
    if (!form) return;
    if (!this.tsExpiryInput) {
      this.notificationService.showError('Choose an expiry date.');
      return;
    }
    const expiry = new Date(`${this.tsExpiryInput}T23:59:59`).getTime();
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      this.notificationService.showError('Choose a future expiry date.');
      return;
    }
    const { lotId, price } = form;
    let config: LotStopConfig;
    if (this.tsMode() === 'limit') {
      const limit = Number(this.tsLimitInput);
      if (!Number.isFinite(limit) || limit <= 0) {
        this.notificationService.showError('Enter a valid limit price above 0.');
        return;
      }
      config = { mode: 'limit', pct: 0, peak: price, stop: +limit.toFixed(4), above: limit >= price, expiry, status: 'active', symbol: form.symbol, watchlist: this.watchlistName() };
    } else {
      const pct = Number(this.tsPctInput);
      if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
        this.notificationService.showError('Enter a valid trailing stop percentage between 0 and 100.');
        return;
      }
      const stop = +(price * (1 - pct / 100)).toFixed(4);
      config = { mode: 'trailing', pct, peak: price, stop, above: false, expiry, status: 'active', symbol: form.symbol, watchlist: this.watchlistName() };
    }
    this.stopMonitor.set(lotId, config);
    this.trailingStopForm.set(null);
    const row = this.watchlistRows().find(r => r.lotId === lotId);
    if (row) this.ensureLotExpanded(row);
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

  /** True N-trading-day SMAs (per `periods`) from daily closes, one value PER SESSION DATE (so a
   *  multi-day intraday chart shows the real day-to-day drift instead of one static number). */
  async #computeDailyMovingAverages(symbol: string, periods: number[]): Promise<Map<string, Partial<Record<number, number>>>> {
    const byDate = new Map<string, Partial<Record<number, number>>>();
    const start = new Date(Date.now() - 400 * 86_400_000).toISOString().split('T')[0];
    const result = await firstValueFrom(this.alpacaService.getBars(symbol, '1Day', start, undefined, 1000));
    const bars = result?.body?.bars ?? [];
    if (!bars.length) return byDate;
    const closes = bars.map(b => b.c);
    for (let i = 0; i < bars.length; i++) {
      const entry: Partial<Record<number, number>> = {};
      for (const period of periods) {
        if (i + 1 >= period) entry[period] = +(closes.slice(i + 1 - period, i + 1).reduce((s, c) => s + c, 0) / period).toFixed(2);
      }
      byDate.set(etSessionDate(bars[i].t), entry);
    }
    return byDate;
  }

  private async loadChart(lotId: string, silent = false): Promise<void> {
    const targetRow = this.watchlistRows().find(r => r.lotId === lotId);
    if (!targetRow) return;
    const symbol = targetRow.symbol;
    if (!silent) {
      this.watchlistRows.update(rows => rows.map(r =>
        r.lotId === lotId ? { ...r, chartLoading: true, chartData: [] } : r
      ));
    }

    const range = targetRow.range;
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
      // Moving averages must represent true N-TRADING-DAY SMAs everywhere so they match standard
      // usage (and the Stock Picker's 200-day gate). On intraday ranges (1D/5D/1M) the loaded bars
      // are minutes/hours, not days, so those MAs come from a separate daily-bar fetch and are
      // looked up PER SESSION DATE (stepping day-to-day, not a single flat value). Only the periods
      // enabled in Settings are computed.
      const periods = this.appSettingsService.movingAveragePeriods();
      const maData: Partial<Record<number, LineData<Time>[]>> = {};
      for (const period of periods) maData[period] = [];
      if (isIntraday) {
        const byDate = await this.#computeDailyMovingAverages(symbol, periods);
        if (byDate.size && chartData.length) {
          const dates = [...byDate.keys()].sort();
          for (let i = 0; i < bars.length; i++) {
            const d = etSessionDate(bars[i].t);
            // Fall back to the latest known prior session (e.g. today, before its own daily bar lands).
            const mas = byDate.get(d) ?? byDate.get([...dates].reverse().find(x => x <= d) ?? dates[0]);
            const time = chartData[i].time;
            for (const period of periods) {
              const v = mas?.[period];
              if (v != null) maData[period]!.push({ time, value: v });
            }
          }
        }
      } else if (chartData.length > 0) {
        for (const period of periods) {
          const arr: LineData<Time>[] = [];
          let sum = 0;
          for (let i = 0; i < chartData.length; i++) {
            sum += chartData[i].value;
            if (i >= period) {
              sum -= chartData[i - period].value;
              arr.push({ time: chartData[i].time, value: +(sum / period).toFixed(2) });
            } else {
              arr.push({ time: chartData[i].time, value: +(sum / (i + 1)).toFixed(2) });
            }
          }
          maData[period] = arr;
        }
      }
      // Build volume data from bars, colored by candle direction (close vs open).
      const volumeData: HistogramData<Time>[] = bars.map((bar, i) => ({
        time: chartData[i].time,
        value: bar.v,
        color: bar.c >= bar.o ? 'rgba(40, 167, 69, 0.5)' : 'rgba(220, 53, 69, 0.5)',
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
      // 1D keeps only the last two sessions in `bars`, so use the wider `rawBars` window
      // to resolve the previous-day range plus the swing day before it.
      const rangeLevels = range === '5D' ? buildRangeLevels(bars)
        : range === '1D' ? buildRangeLevels(rawBars)
        : null;
      const openingRange = range === '1D' ? buildOpeningRange(currentSessionBars) : null;
      this.watchlistRows.update(rows => rows.map(r =>
        r.lotId === lotId ? {
          ...r,
          chartData,
          candleData,
          chartLoading: false,
          maData,
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
      if (this.peerSymbols().has(lotId)) {
        this.loadPeer(lotId);
      }
    } catch {
      this.watchlistRows.update(rows => rows.map(r =>
        r.lotId === lotId ? { ...r, chartLoading: false } : r
      ));
    }
  }
}
