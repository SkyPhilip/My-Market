import { Component, OnInit, OnDestroy, computed, signal, inject, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlpacaService } from '../../services/alpaca.service';
import { ChartComponent } from '../chart/chart.component';
import { WatchlistComponent } from '../watchlist/watchlist.component';
import { fetchFnWithState } from '../../utils/fetch-rx';
import { AlpacaBarsResponse, AlpacaErrorBody, AlpacaSnapshotsResponse } from '../../models/alpaca.models';
import { LineData, Time } from 'lightweight-charts';

type TimeRange = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'All';

interface RangeConfig {
  timeframe: string;
  getStart: () => string;
}

const RANGE_CONFIGS: Record<TimeRange, RangeConfig> = {
  '1D':  { timeframe: '5Min',   getStart: () => new Date().toISOString().split('T')[0] },
  '5D':  { timeframe: '15Min',  getStart: () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; } },
  '1M':  { timeframe: '1Hour',  getStart: () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0]; } },
  '6M':  { timeframe: '1Day',   getStart: () => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().split('T')[0]; } },
  'YTD': { timeframe: '1Day',   getStart: () => `${new Date().getFullYear()}-01-01` },
  '1Y':  { timeframe: '1Day',   getStart: () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().split('T')[0]; } },
  '5Y':  { timeframe: '1Week',  getStart: () => { const d = new Date(); d.setFullYear(d.getFullYear() - 5); return d.toISOString().split('T')[0]; } },
  'All': { timeframe: '1Month', getStart: () => '2000-01-01' },
};

interface IndexCard {
  symbol: string;
  name: string;
  currentPrice: number | null;
  change: number | null;
  changePercent: number | null;
  chartData: LineData<Time>[];
  maData: LineData<Time>[];
  color: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ChartComponent, WatchlistComponent],
  template: `
    <div class="dashboard">
      <h2>Market Overview</h2>
      <div class="range-selector">
        @for (range of timeRanges; track range) {
          <button
            class="range-btn"
            [class.active]="selectedRange() === range"
            (click)="selectRange(range)"
          >{{ range }}</button>
        }
      </div>
      @if (summaryState().prefetchOrBusy) {
        <p class="loading">Loading market data...</p>
      } @else if (summaryState().errorResOrException) {
        <p class="loading">Failed to load market data. <button (click)="fetchSummary()">Retry</button></p>
      }
      <div class="index-cards">
        @for (card of indices(); track card.symbol) {
          <div class="index-card">
            <div class="index-card__header">
              <span class="index-card__name">{{ card.name }}</span>
              <span class="index-card__symbol">{{ card.symbol }}</span>
            </div>
            <div class="index-card__price">
              @if (card.currentPrice !== null) {
                <span class="price">{{'$'}}{{ card.currentPrice | number:'1.2-2' }}</span>
                @if (card.change !== null) {
                  <span class="change" [class.positive]="card.change >= 0" [class.negative]="card.change < 0">
                    {{ card.change >= 0 ? '+' : '' }}{{ card.change | number:'1.2-2' }}
                    ({{ card.changePercent! >= 0 ? '+' : '' }}{{ card.changePercent | number:'1.2-2' }}%)
                  </span>
                }
              } @else if (!summaryState().prefetchOrBusy) {
                <span class="loading">No data available</span>
              } @else {
                <span class="loading">Loading...</span>
              }
            </div>
            <app-chart [data]="card.chartData" [color]="card.color" [maData]="card.maData"></app-chart>
          </div>
        }
      </div>

      <app-watchlist
        title="Current Holdings"
        watchlistName="Current Holdings"
      />
      <app-watchlist
        title="Watch List"
        watchlistName="Watch List"
      />
    </div>
  `,
  styles: [`
    .dashboard {
      padding: 24px;
    }
    h2 {
      color: #e0e0e0;
      margin: 0 0 20px;
      font-size: 22px;
    }
    .index-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 20px;
    }
    .index-card {
      background: #16213e;
      border-radius: 10px;
      padding: 20px;
      border: 1px solid #2a3a5e;
    }
    .index-card__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .index-card__name {
      color: #e0e0e0;
      font-size: 16px;
      font-weight: 600;
    }
    .index-card__symbol {
      color: #8892b0;
      font-size: 13px;
    }
    .index-card__price {
      margin-bottom: 12px;
    }
    .price {
      color: #e0e0e0;
      font-size: 24px;
      font-weight: 700;
      margin-right: 12px;
    }
    .change {
      font-size: 14px;
    }
    .change.positive {
      color: #28a745;
    }
    .change.negative {
      color: #dc3545;
    }
    .loading {
      color: #8892b0;
      font-size: 14px;
    }
    .range-selector {
      display: flex;
      gap: 4px;
      margin-bottom: 20px;
    }
    .range-btn {
      background: #0f1a30;
      border: 1px solid #2a3a5e;
      border-radius: 6px;
      color: #8892b0;
      padding: 6px 12px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s;
    }
    .range-btn:hover {
      color: #e0e0e0;
      border-color: #4a9eff;
    }
    .range-btn.active {
      background: #4a9eff;
      color: #fff;
      border-color: #4a9eff;
    }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  private alpacaService = inject(AlpacaService);
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly REFRESH_MS = 15 * 60 * 1000;

  private static readonly SYMBOLS = ['DIA', 'SPY', 'QQQ'] as const;
  private static readonly CARD_DEFAULTS: IndexCard[] = [
    { symbol: 'DIA', name: 'Dow Jones', currentPrice: null, change: null, changePercent: null, chartData: [], maData: [], color: '#4a9eff' },
    { symbol: 'SPY', name: 'S&P 500', currentPrice: null, change: null, changePercent: null, chartData: [], maData: [], color: '#28a745' },
    { symbol: 'QQQ', name: 'Nasdaq', currentPrice: null, change: null, changePercent: null, chartData: [], maData: [], color: '#ffc107' },
  ];

  readonly indices: WritableSignal<IndexCard[]> = signal<IndexCard[]>(DashboardComponent.CARD_DEFAULTS);

  readonly timeRanges: TimeRange[] = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'All'];
  readonly selectedRange = signal<TimeRange>('1D');

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
    this.loadCharts();
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
          const period = 50;
          if (chartData.length > 0) {
            let sum = 0;
            for (let i = 0; i < chartData.length; i++) {
              sum += chartData[i].value;
              if (i >= period) {
                sum -= chartData[i - period].value;
                maData.push({ time: chartData[i].time, value: +(sum / period).toFixed(2) });
              } else {
                maData.push({ time: chartData[i].time, value: +(sum / (i + 1)).toFixed(2) });
              }
            }
          }
          updates.maData = maData;
          return { ...c, ...updates };
        }));
      }
    }
  }
}
