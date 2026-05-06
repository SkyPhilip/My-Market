import { Component, OnInit, computed, signal, inject, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlpacaService } from '../../services/alpaca.service';
import { ChartComponent } from '../chart/chart.component';
import { fetchFnWithState } from '../../utils/fetch-rx';
import { AlpacaBarsResponse, AlpacaErrorBody, AlpacaSnapshotsResponse } from '../../models/alpaca.models';
import { LineData, Time } from 'lightweight-charts';

interface IndexCard {
  symbol: string;
  name: string;
  currentPrice: number | null;
  change: number | null;
  changePercent: number | null;
  chartData: LineData<Time>[];
  color: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  template: `
    <div class="dashboard">
      <h2>Market Overview</h2>
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
            <app-chart [data]="card.chartData" [color]="card.color"></app-chart>
          </div>
        }
      </div>
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
  `]
})
export class DashboardComponent implements OnInit {
  private alpacaService = inject(AlpacaService);

  private static readonly SYMBOLS = ['DIA', 'SPY', 'QQQ'] as const;
  private static readonly CARD_DEFAULTS: IndexCard[] = [
    { symbol: 'DIA', name: 'Dow Jones', currentPrice: null, change: null, changePercent: null, chartData: [], color: '#4a9eff' },
    { symbol: 'SPY', name: 'S&P 500', currentPrice: null, change: null, changePercent: null, chartData: [], color: '#28a745' },
    { symbol: 'QQQ', name: 'Nasdaq', currentPrice: null, change: null, changePercent: null, chartData: [], color: '#ffc107' },
  ];

  readonly indices: WritableSignal<IndexCard[]> = signal<IndexCard[]>(DashboardComponent.CARD_DEFAULTS);

  fetchSummary = fetchFnWithState<AlpacaSnapshotsResponse, AlpacaErrorBody>(() =>
    this.alpacaService.getMarketSummary()
  );

  fetchBars = fetchFnWithState<AlpacaBarsResponse, AlpacaErrorBody, string>((symbol: string) => {
    const today = new Date().toISOString().split('T')[0];
    return this.alpacaService.getBars(symbol, '5Min', today, today);
  });

  summaryState = computed(() => {
    const { prefetchOrBusy, okRes, errorResOrException } = this.fetchSummary.state();
    return { prefetchOrBusy, okRes, errorResOrException };
  });

  ngOnInit(): void {
    this.loadMarketSummary();
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
    for (const card of this.indices()) {
      const result = await this.fetchBars(card.symbol);
      if (result.okRes) {
        const rawBars = result.okRes.body?.bars ?? [];
        const chartData: LineData<Time>[] = rawBars.map(bar => ({
          time: Math.floor(new Date(bar.t).getTime() / 1000) as Time,
          value: bar.c
        }));
        this.indices.update(cards => cards.map(c => {
          if (c.symbol !== card.symbol) return c;
          const updates: Partial<IndexCard> = { chartData };
          if (c.currentPrice === null && rawBars.length > 0) {
            updates.currentPrice = rawBars[rawBars.length - 1].c;
          }
          return { ...c, ...updates };
        }));
      }
    }
  }
}
