import { Component, OnInit, OnDestroy, computed, signal, inject, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlpacaService } from '../../services/alpaca.service';
import { ChartComponent } from '../chart/chart.component';
import { WatchlistComponent } from '../watchlist/watchlist.component';
import { WatchlistService } from '../../services/watchlist.service';
import { fetchFnWithState } from '../../utils/fetch-rx';
import { AlpacaBarsResponse, AlpacaErrorBody, AlpacaSnapshot, AlpacaSnapshotsResponse } from '../../models/alpaca.models';
import { LineData, Time } from 'lightweight-charts';
import { firstValueFrom } from 'rxjs';

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

const RANGE_CONFIGS: Record<TimeRange, RangeConfig> = {
  '1D':  { timeframe: '5Min',   getStart: () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) },
  '5D':  { timeframe: '15Min',  getStart: () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; } },
  '1M':  { timeframe: '1Hour',  getStart: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0]; } },
  '6M':  { timeframe: '1Day',   getStart: () => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().split('T')[0]; } },
  'YTD': { timeframe: '1Day',   getStart: () => `${new Date().getFullYear()}-01-01` },
  '1Y':  { timeframe: '1Day',   getStart: () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().split('T')[0]; } },
  '5Y':  { timeframe: '1Week',  getStart: () => { const d = new Date(); d.setFullYear(d.getFullYear() - 5); return d.toISOString().split('T')[0]; } },
  'All': { timeframe: '1Month', getStart: () => '2000-01-01' },
};

interface HoldingRow {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
}

interface IndexCard {
  symbol: string;
  name: string;
  currentPrice: number | null;
  change: number | null;
  changePercent: number | null;
  chartData: LineData<Time>[];
  maData: LineData<Time>[];
  ma150Data: LineData<Time>[];
  volumeData: LineData<Time>[];
  volumeProfileData: VolumeProfileBin[];
  rangeHigh: number | null;
  rangeLow: number | null;
  swingHigh: number | null;
  swingLow: number | null;
  color: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ChartComponent, WatchlistComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private alpacaService = inject(AlpacaService);
  private watchlistService = inject(WatchlistService);
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly REFRESH_MS = 15 * 60 * 1000;

  private static readonly SYMBOLS = ['DIA', 'SPY', 'QQQ'] as const;
  private static readonly CARD_DEFAULTS: IndexCard[] = [
    { symbol: 'DIA', name: 'Dow Jones', currentPrice: null, change: null, changePercent: null, chartData: [], maData: [], ma150Data: [], volumeData: [], volumeProfileData: [], rangeHigh: null, rangeLow: null, swingHigh: null, swingLow: null, color: '#4a9eff' },
    { symbol: 'SPY', name: 'S&P 500', currentPrice: null, change: null, changePercent: null, chartData: [], maData: [], ma150Data: [], volumeData: [], volumeProfileData: [], rangeHigh: null, rangeLow: null, swingHigh: null, swingLow: null, color: '#28a745' },
    { symbol: 'QQQ', name: 'Nasdaq', currentPrice: null, change: null, changePercent: null, chartData: [], maData: [], ma150Data: [], volumeData: [], volumeProfileData: [], rangeHigh: null, rangeLow: null, swingHigh: null, swingLow: null, color: '#ffc107' },
  ];

  // Top 6 constituents per index ETF (symbol + company name), roughly by weight.
  private static readonly TOP_HOLDINGS: Record<string, ReadonlyArray<{ symbol: string; name: string }>> = {
    DIA: [
      { symbol: 'GS', name: 'Goldman Sachs' },
      { symbol: 'MSFT', name: 'Microsoft' },
      { symbol: 'HD', name: 'Home Depot' },
      { symbol: 'CAT', name: 'Caterpillar' },
      { symbol: 'SHW', name: 'Sherwin-Williams' },
      { symbol: 'V', name: 'Visa' },
    ],
    SPY: [
      { symbol: 'AAPL', name: 'Apple' },
      { symbol: 'MSFT', name: 'Microsoft' },
      { symbol: 'NVDA', name: 'NVIDIA' },
      { symbol: 'AMZN', name: 'Amazon' },
      { symbol: 'META', name: 'Meta Platforms' },
      { symbol: 'GOOGL', name: 'Alphabet' },
    ],
    QQQ: [
      { symbol: 'AAPL', name: 'Apple' },
      { symbol: 'MSFT', name: 'Microsoft' },
      { symbol: 'NVDA', name: 'NVIDIA' },
      { symbol: 'AMZN', name: 'Amazon' },
      { symbol: 'AVGO', name: 'Broadcom' },
      { symbol: 'META', name: 'Meta Platforms' },
    ],
  };

  readonly indices: WritableSignal<IndexCard[]> = signal<IndexCard[]>(DashboardComponent.CARD_DEFAULTS);

  readonly openHoldings = signal<Set<string>>(new Set());
  readonly holdingsLoading = signal<Set<string>>(new Set());
  readonly holdingsData = signal<Record<string, HoldingRow[]>>({});

  readonly timeRanges: TimeRange[] = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'All'];
  readonly selectedRange = signal<TimeRange>('1D');
  readonly showMovingAverage = signal(false);
  readonly showMovingAverage150 = signal(false);
  readonly showRangeLevels = signal(false);

  fetchSummary = fetchFnWithState<AlpacaSnapshotsResponse, AlpacaErrorBody>(() =>
    this.alpacaService.getMarketSummary()
  );

  fetchBars = fetchFnWithState<AlpacaBarsResponse, AlpacaErrorBody, string>((symbol: string) => {
    const config = RANGE_CONFIGS[this.selectedRange()];
    return this.alpacaService.getBars(symbol, config.timeframe, config.getStart());
  });

  summaryState = computed(() => {
    const { prefetchOrBusy, okRes, errorResOrException } = this.fetchSummary.state();
    return { prefetchOrBusy, okRes, errorResOrException };
  });

  ngOnInit(): void {
    this.loadMarketSummary();
    this.loadCharts();
    this.refreshInterval = setInterval(() => {
      this.loadMarketSummary();
      this.loadCharts();
    }, DashboardComponent.REFRESH_MS);
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  selectRange(range: TimeRange): void {
    this.selectedRange.set(range);
    if (range !== '5D') {
      this.showRangeLevels.set(false);
    }
    this.loadCharts();
  }

  toggleRangeLevels(): void {
    if (this.selectedRange() !== '5D') return;
    this.showRangeLevels.set(!this.showRangeLevels());
  }

  toggleMovingAverage(): void {
    this.showMovingAverage.set(!this.showMovingAverage());
  }

  toggleMovingAverage150(): void {
    this.showMovingAverage150.set(!this.showMovingAverage150());
  }

  addToWatchList(symbol: string): void {
    this.watchlistService.addSymbol('Watch List', symbol);
  }

  inWatchList(symbol: string): boolean {
    this.watchlistService.version('Watch List')(); // reactive dependency
    return this.watchlistService.has('Watch List', symbol);
  }

  isHoldingsOpen(symbol: string): boolean {
    return this.openHoldings().has(symbol);
  }

  isHoldingsLoading(symbol: string): boolean {
    return this.holdingsLoading().has(symbol);
  }

  holdingsFor(symbol: string): HoldingRow[] {
    return this.holdingsData()[symbol] ?? [];
  }

  toggleHoldings(symbol: string): void {
    const next = new Set(this.openHoldings());
    if (next.has(symbol)) {
      next.delete(symbol);
    } else {
      next.add(symbol);
      if (!this.holdingsData()[symbol]) {
        this.loadHoldings(symbol);
      }
    }
    this.openHoldings.set(next);
  }

  private async loadHoldings(symbol: string): Promise<void> {
    const holdings = DashboardComponent.TOP_HOLDINGS[symbol];
    if (!holdings?.length) return;

    this.holdingsLoading.update(set => new Set(set).add(symbol));
    try {
      const res = await firstValueFrom(this.alpacaService.getSnapshots(holdings.map(h => h.symbol)));
      const snapshots = res.body ?? {};
      const rows: HoldingRow[] = holdings.map(h => {
        const snap: AlpacaSnapshot | undefined = snapshots[h.symbol];
        const price = snap?.latestTrade?.p ?? snap?.minuteBar?.c ?? snap?.dailyBar?.c ?? null;
        const prevClose = snap?.prevDailyBar?.c ?? null;
        const change = price !== null && prevClose !== null ? +(price - prevClose).toFixed(2) : null;
        const changePercent = change !== null && prevClose ? +((change / prevClose) * 100).toFixed(2) : null;
        const volume = snap?.dailyBar?.v ?? null;
        return { symbol: h.symbol, name: h.name, price, change, changePercent, volume };
      });
      this.holdingsData.update(data => ({ ...data, [symbol]: rows }));
    } catch {
      // Holdings data is supplementary; leave the table empty on failure.
    } finally {
      this.holdingsLoading.update(set => {
        const next = new Set(set);
        next.delete(symbol);
        return next;
      });
    }
  }

  private async loadMarketSummary(): Promise<void> {
    const result = await this.fetchSummary();
    if (result.okRes) {
      const snapshots = result.okRes.body;
      if (!snapshots) return;
      this.indices.update(cards => cards.map(card => {
        const snap = snapshots[card.symbol];
        if (!snap) return card;
        const currentPrice = snap.latestTrade?.p ?? snap.minuteBar?.c ?? null;
        const prevClose = snap.prevDailyBar?.c ?? null;
        const change = currentPrice && prevClose ? +(currentPrice - prevClose).toFixed(2) : null;
        const changePercent = currentPrice && prevClose ? +((change! / prevClose) * 100).toFixed(2) : null;
        return { ...card, currentPrice, change, changePercent };
      }));
    }
  }

  private async loadCharts(): Promise<void> {
    const range = this.selectedRange();
    const isIntraday = range === '1D' || range === '5D' || range === '1M';

    for (const card of this.indices()) {
      const result = await this.fetchBars(card.symbol);
      if (result.okRes) {
        const rawBars = result.okRes.body?.bars ?? [];
        const chartData: LineData<Time>[] = rawBars.map(bar => {
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
        this.indices.update(cards => cards.map(c => {
          if (c.symbol !== card.symbol) return c;
          const updates: Partial<IndexCard> = { chartData };
          if (c.currentPrice === null && rawBars.length > 0) {
            updates.currentPrice = rawBars[rawBars.length - 1].c;
          }
          // Compute 50-period moving average (cumulative for first 49 points)
          const maData: LineData<Time>[] = [];
          const ma150Data: LineData<Time>[] = [];
          const period = 50;
          const period150 = 150;
          if (chartData.length > 0) {
            let sum = 0;
            let sum150 = 0;
            for (let i = 0; i < chartData.length; i++) {
              sum += chartData[i].value;
              sum150 += chartData[i].value;
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
            }
          }
          updates.maData = maData;
          updates.ma150Data = ma150Data;
          // Build volume data from bars
          const volumeData: LineData<Time>[] = rawBars.map((bar, i) => ({
            time: chartData[i].time,
            value: bar.v
          }));
          const volumeProfileData = buildVolumeProfile(rawBars);
          const rangeLevels = range === '5D' ? buildRangeLevels(rawBars) : null;
          updates.volumeData = volumeData;
          updates.volumeProfileData = volumeProfileData;
          updates.rangeHigh = rangeLevels?.rangeHigh ?? null;
          updates.rangeLow = rangeLevels?.rangeLow ?? null;
          updates.swingHigh = rangeLevels?.swingHigh ?? null;
          updates.swingLow = rangeLevels?.swingLow ?? null;
          return { ...c, ...updates };
        }));
      }
    }
  }
}
