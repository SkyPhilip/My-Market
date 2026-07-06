import { Component, OnInit, computed, signal, inject, input, effect, HostListener, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AlpacaService } from '../../services/alpaca.service';
import { FmpService } from '../../services/fmp.service';
import { FinnhubService } from '../../services/finnhub.service';
import { fetchFnWithState } from '../../utils/fetch-rx';
import { AlpacaErrorBody, AlpacaBarsResponse, AlpacaSnapshotsResponse, AlpacaSnapshot } from '../../models/alpaca.models';
import { FinnhubNewsArticle, FinnhubMetrics, FinnhubRecommendation } from '../../models/finnhub.models';
import { ChartComponent } from '../chart/chart.component';
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
  maData: LineData<Time>[];
  ma150Data: LineData<Time>[];
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
  showMovingAverage: boolean;
  showMovingAverage150: boolean;
  showRangeLevels: boolean;
  peerSymbol: string | null;
  peerName: string | null;
  peerData: LineData<Time>[];
  peerLoading: boolean;
  metrics: FinnhubMetrics | null;
  metricsLoading: boolean;
  recommendation: FinnhubRecommendation | null;
  recommendationLoading: boolean;
}

type SortColumn = 'symbol' | 'name' | 'sector' | 'price' | 'change' | 'changePercent' | 'volume' | 'pegy' | 'dividendYield' | 'costBasis' | 'shares' | 'totalCost' | 'marketValue' | 'gainLoss' | 'gainLossPercent' | 'totalGainLoss' | 'totalGainLossPercent';
type SortDirection = 'asc' | 'desc';

type WatchlistEntry = string | { symbol: string; costBasis: number; shares?: number };

@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [CommonModule, FormsModule, ChartComponent],
  template: `
    <div class="watchlist-section">
      <h2>{{ title() }}</h2>
      <div class="watchlist-actions">
        <form class="watchlist-form" (submit)="addSymbol($event)">
          <div class="input-wrapper">
            <input
              type="text"
              [(ngModel)]="newSymbol"
              name="symbol"
              placeholder="Add ticker (e.g. AAPL)"
              class="watchlist-input"
              [disabled]="adding()"
            />
            @if (newSymbol) {
              <button type="button" class="clear-btn" (click)="clearInput()">✕</button>
            }
          </div>
          @if (isCurrentHoldings()) {
            <input
              type="number"
              [(ngModel)]="newShares"
              name="shares"
              placeholder="Shares"
              class="watchlist-input holding-input"
              min="0"
              step="0.0001"
              [disabled]="adding()"
            />
            <input
              type="number"
              [(ngModel)]="newCostBasis"
              name="costBasis"
              placeholder="Cost/Share"
              class="watchlist-input holding-input"
              min="0"
              step="0.01"
              [disabled]="adding()"
            />
          }
          <button type="submit" class="watchlist-btn add-btn" [disabled]="!canSubmitSymbol() || adding()">Add</button>
        </form>
        <div class="io-buttons">
          <button class="watchlist-btn io-btn" (click)="exportWatchlist()">Export</button>
          <label class="watchlist-btn io-btn import-label">
            Import
            <input type="file" accept=".json" (change)="importWatchlist($event)" hidden />
          </label>
        </div>
      </div>
      @if (addError()) {
        <p class="add-error">{{ addError() }}</p>
      }
      @if (watchlistState().prefetchOrBusy) {
        <p class="loading">Loading {{ title() | lowercase }}...</p>
      } @else if (watchlistState().errorResOrException) {
        <p class="loading">Failed to load. <button (click)="loadWatchlist()">Retry</button></p>
      } @else if (watchlistRows().length) {
        <table class="watchlist-table">
          <thead>
            <tr>
              <th class="sortable" (click)="sortBy('symbol')">Symbol <span class="sort-icon">{{ sortIcon('symbol') }}</span></th>
              <th class="sortable" (click)="sortBy('name')">Name <span class="sort-icon">{{ sortIcon('name') }}</span></th>
              <th class="sortable" (click)="sortBy('sector')">Sector <span class="sort-icon">{{ sortIcon('sector') }}</span></th>
              <th class="sortable" (click)="sortBy('price')">Price <span class="sort-icon">{{ sortIcon('price') }}</span></th>
              <th class="sortable" (click)="sortBy('change')">Change <span class="sort-icon">{{ sortIcon('change') }}</span></th>
              <th class="sortable" (click)="sortBy('changePercent')">Change % <span class="sort-icon">{{ sortIcon('changePercent') }}</span></th>
              <th class="sortable" (click)="sortBy('volume')">Volume <span class="sort-icon">{{ sortIcon('volume') }}</span></th>
              <th class="sortable" (click)="sortBy('pegy')">PEGY <span class="sort-icon">{{ sortIcon('pegy') }}</span></th>
              <th class="sortable" (click)="sortBy('dividendYield')">Div Yield <span class="sort-icon">{{ sortIcon('dividendYield') }}</span></th>
              @if (hasCostBasis()) {
                <th class="sortable" (click)="sortBy('shares')">Shares <span class="sort-icon">{{ sortIcon('shares') }}</span></th>
                <th class="sortable" (click)="sortBy('costBasis')">Cost <span class="sort-icon">{{ sortIcon('costBasis') }}</span></th>
                <th class="sortable" (click)="sortBy('totalCost')">Total Cost <span class="sort-icon">{{ sortIcon('totalCost') }}</span></th>
                <th class="sortable" (click)="sortBy('marketValue')">Mkt Value <span class="sort-icon">{{ sortIcon('marketValue') }}</span></th>
                <th class="sortable" (click)="sortBy('gainLoss')">G/L <span class="sort-icon">{{ sortIcon('gainLoss') }}</span></th>
                <th class="sortable" (click)="sortBy('gainLossPercent')">G/L % <span class="sort-icon">{{ sortIcon('gainLossPercent') }}</span></th>
                <th class="sortable" (click)="sortBy('totalGainLoss')">Total G/L <span class="sort-icon">{{ sortIcon('totalGainLoss') }}</span></th>
                <th class="sortable" (click)="sortBy('totalGainLossPercent')">Total G/L % <span class="sort-icon">{{ sortIcon('totalGainLossPercent') }}</span></th>
              }
              <th class="news-col">Docs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (row of sortedWatchlistRows(); track row.symbol) {
              <tr class="clickable-row" [class.expanded]="expandedSymbols().has(row.symbol)" (click)="toggleChart(row.symbol)">
                <td class="symbol">
                  <span class="symbol-text">{{ row.symbol }}</span>
                </td>
                <td class="name">{{ row.name }}</td>
                <td class="sector">{{ row.sector }}</td>
                <td class="price">{{ row.price !== null ? ('$' + (row.price | number:'1.2-2')) : '—' }}</td>
                <td class="change" [class.positive]="(row.change ?? 0) >= 0" [class.negative]="(row.change ?? 0) < 0">
                  {{ row.change !== null ? ((row.change >= 0 ? '+' : '') + (row.change | number:'1.2-2')) : '—' }}
                </td>
                <td class="change" [class.positive]="(row.changePercent ?? 0) >= 0" [class.negative]="(row.changePercent ?? 0) < 0">
                  {{ row.changePercent !== null ? ((row.changePercent >= 0 ? '+' : '') + (row.changePercent | number:'1.2-2') + '%') : '—' }}
                </td>
                <td class="volume">{{ formatVolume(row.volume) }}</td>
                <td class="price">
                  @if (row.pegyLoading) {
                    <span class="pegy-pending">…</span>
                  } @else if (row.pegyLoaded) {
                    <button type="button" class="pegy-btn computed" [title]="pegyTooltip" (click)="loadPegy(row.symbol); $event.stopPropagation()">{{ row.pegy !== null ? (row.pegy | number:'1.3-3') : 'N/A' }}</button>
                  } @else {
                    <button type="button" class="pegy-btn" [title]="pegyTooltip" (click)="loadPegy(row.symbol); $event.stopPropagation()">PEGY</button>
                  }
                </td>
                <td class="price">{{ row.dividendYield !== null ? ((row.dividendYield | number:'1.2-2') + '%') : '—' }}</td>
                @if (hasCostBasis()) {
                  <td class="shares">{{ row.shares !== null ? (row.shares | number:'1.0-4') : '—' }}</td>
                  <td class="price">{{ row.costBasis !== null ? ('$' + (row.costBasis | number:'1.2-2')) : '—' }}</td>
                  <td class="price">{{ row.totalCost !== null ? ('$' + (row.totalCost | number:'1.2-2')) : '—' }}</td>
                  <td class="price">{{ row.marketValue !== null ? ('$' + (row.marketValue | number:'1.2-2')) : '—' }}</td>
                  <td class="change" [class.positive]="(row.gainLoss ?? 0) >= 0" [class.negative]="(row.gainLoss ?? 0) < 0">
                    {{ row.gainLoss !== null ? ((row.gainLoss >= 0 ? '+' : '') + (row.gainLoss | number:'1.2-2')) : '—' }}
                  </td>
                  <td class="change" [class.positive]="(row.gainLossPercent ?? 0) >= 0" [class.negative]="(row.gainLossPercent ?? 0) < 0">
                    {{ row.gainLossPercent !== null ? ((row.gainLossPercent >= 0 ? '+' : '') + (row.gainLossPercent | number:'1.2-2') + '%') : '—' }}
                  </td>
                  <td class="change" [class.positive]="(row.totalGainLoss ?? 0) >= 0" [class.negative]="(row.totalGainLoss ?? 0) < 0">
                    {{ row.totalGainLoss !== null ? ((row.totalGainLoss >= 0 ? '+$' : '-$') + (row.totalGainLoss >= 0 ? row.totalGainLoss : -row.totalGainLoss | number:'1.2-2')) : '—' }}
                  </td>
                  <td class="change" [class.positive]="(row.totalGainLossPercent ?? 0) >= 0" [class.negative]="(row.totalGainLossPercent ?? 0) < 0">
                    {{ row.totalGainLossPercent !== null ? ((row.totalGainLossPercent >= 0 ? '+' : '') + (row.totalGainLossPercent | number:'1.2-2') + '%') : '—' }}
                  </td>
                }
                <td class="news-col">
                  <button
                    type="button"
                    class="watchlist-btn news-btn"
                    (click)="openNews(row.symbol); $event.stopPropagation()"
                    [attr.aria-label]="'View news for ' + row.symbol"
                    title="View news"
                  >📰</button>
                </td>
                <td><button type="button" class="watchlist-btn remove-btn" (click)="removeSymbol(row.symbol); $event.stopPropagation()">✕</button></td>
              </tr>
              @if (expandedSymbols().has(row.symbol)) {
                <tr class="chart-row">
                  <td [attr.colspan]="hasCostBasis() ? 19 : 11">
                    @if (row.chartLoading) {
                      <p class="chart-loading">Loading chart...</p>
                    } @else {
                      <div class="chart-panel" [class.fullscreen]="fullscreenSymbol() === row.symbol">
                        <div class="chart-toolbar">
                          <span class="chart-title">{{ row.symbol }}<span class="chart-title__name">{{ row.name }}</span></span>
                          @for (range of timeRanges; track range) {
                            <button
                              type="button"
                              class="range-btn"
                              [class.active]="row.range === range"
                              (click)="selectRange(row.symbol, range)"
                            >{{ range }}</button>
                          }
                          <button
                            type="button"
                            class="range-btn ma50-btn"
                            [class.active]="row.showMovingAverage"
                            (click)="toggleMovingAverage(row.symbol)"
                            title="Show or hide the 50-day moving average"
                          >50MA</button>
                          <button
                            type="button"
                            class="range-btn ma150-btn"
                            [class.active]="row.showMovingAverage150"
                            (click)="toggleMovingAverage150(row.symbol)"
                            title="Show or hide the 150-day moving average"
                          >150MA</button>
                          @if (row.range === '5D') {
                            <button
                              type="button"
                              class="range-btn"
                              [class.active]="row.showRangeLevels"
                              (click)="toggleRangeLevels(row.symbol)"
                              title="Show previous day range lines on 5D charts"
                            >Range High/Low</button>
                          }
                          @if (row.range === '1D') {
                            <div class="split-btn">
                              <button
                                type="button"
                                class="range-btn"
                                [class.active]="openingRangeSymbols().has(row.symbol)"
                                (click)="toggleOpeningRange(row.symbol)"
                                title="Mark the first 15 minutes (9:30–9:45 ET) high/low"
                              >Opening Range</button>
                              @if (openingRangeSymbols().has(row.symbol)) {
                                <button
                                  type="button"
                                  class="range-btn"
                                  [class.active]="openingRangeNarrowSymbols().has(row.symbol)"
                                  (click)="toggleOpeningRangeNarrow(row.symbol)"
                                  title="Narrow the opening range band by 25% around its midpoint"
                                >−25%</button>
                              }
                            </div>
                          }
                          <button
                            type="button"
                            class="range-btn macd-btn"
                            [class.active]="macdSymbols().has(row.symbol)"
                            (click)="toggleMacd(row.symbol)"
                            title="Show or hide MACD (12/26/9) in a lower pane — most meaningful on 1M+ timeframes"
                          >MACD</button>
                          @if (isEtf(row.symbol)) {
                            <span class="etf-badge" title="ETF/Fund — no comparable peer">ETF</span>
                          } @else {
                            <button
                              type="button"
                              class="peer-btn"
                              [class.active]="peerSymbols().has(row.symbol)"
                              [class.loading]="row.peerLoading"
                              (click)="togglePeer(row.symbol)"
                              [title]="row.peerName ? ('Peer: ' + row.peerName) : (row.peerSymbol ? ('Peer: ' + row.peerSymbol) : 'Show closest peer overlay')"
                            >{{ row.peerLoading ? '…' : (row.peerSymbol ?? 'Peer') }}</button>
                          }
                          <button
                            type="button"
                            class="range-btn fullscreen-btn"
                            (click)="toggleFullscreen(row.symbol)"
                            [title]="fullscreenSymbol() === row.symbol ? 'Exit full screen (Esc)' : 'Expand chart to full screen'"
                          >{{ fullscreenSymbol() === row.symbol ? '✕ Close' : '⛶ Full screen' }}</button>
                        </div>
                        @if (row.metricsLoading) {
                          <div class="fundamentals fundamentals--state">Loading fundamentals…</div>
                        } @else if (row.metrics) {
                          <div class="fundamentals">
                            <span class="fstat" title="Beta — volatility vs. the market (1.0 = market)"><span class="fstat__k">β</span>{{ row.metrics.beta !== null ? (row.metrics.beta | number:'1.2-2') : '—' }}</span>
                            <span class="fstat" title="Price / Earnings (TTM)"><span class="fstat__k">P/E</span>{{ row.metrics.peTTM !== null ? (row.metrics.peTTM | number:'1.1-1') : '—' }}</span>
                            <span class="fstat" title="Price / Sales (TTM)"><span class="fstat__k">P/S</span>{{ row.metrics.psTTM !== null ? (row.metrics.psTTM | number:'1.1-1') : '—' }}</span>
                            <span class="fstat" title="Price / Book"><span class="fstat__k">P/B</span>{{ row.metrics.pbAnnual !== null ? (row.metrics.pbAnnual | number:'1.1-1') : '—' }}</span>
                            <span class="fstat" title="Return on Equity (TTM)"><span class="fstat__k">ROE</span>{{ row.metrics.roeTTM !== null ? ((row.metrics.roeTTM | number:'1.0-0') + '%') : '—' }}</span>
                            <span class="fstat" title="Net profit margin (TTM)"><span class="fstat__k">Margin</span>{{ row.metrics.netMarginTTM !== null ? ((row.metrics.netMarginTTM | number:'1.0-0') + '%') : '—' }}</span>
                            <span class="fstat" title="Total debt / total equity"><span class="fstat__k">D/E</span>{{ row.metrics.debtToEquity !== null ? (row.metrics.debtToEquity | number:'1.2-2') : '—' }}</span>
                            <span class="fstat" title="Current ratio (liquidity)"><span class="fstat__k">Curr</span>{{ row.metrics.currentRatio !== null ? (row.metrics.currentRatio | number:'1.2-2') : '—' }}</span>
                            <span class="fstat" title="Revenue growth (YoY, TTM)" [class.positive]="(row.metrics.revenueGrowthYoY ?? 0) >= 0" [class.negative]="(row.metrics.revenueGrowthYoY ?? 0) < 0"><span class="fstat__k">Rev</span>{{ row.metrics.revenueGrowthYoY !== null ? ((row.metrics.revenueGrowthYoY >= 0 ? '+' : '') + (row.metrics.revenueGrowthYoY | number:'1.0-0') + '%') : '—' }}</span>
                            <span class="fstat" title="EPS growth (5-year)" [class.positive]="(row.metrics.epsGrowth5Y ?? 0) >= 0" [class.negative]="(row.metrics.epsGrowth5Y ?? 0) < 0"><span class="fstat__k">EPS 5Y</span>{{ row.metrics.epsGrowth5Y !== null ? ((row.metrics.epsGrowth5Y >= 0 ? '+' : '') + (row.metrics.epsGrowth5Y | number:'1.0-0') + '%') : '—' }}</span>
                            @if (row.metrics.week52Low !== null && row.metrics.week52High !== null) {
                              <span class="fstat fstat--range" title="52-week range vs. current price">
                                <span class="fstat__k">52W</span>
                                <span class="range52">
                                  <span class="range52__lo">{{ row.metrics.week52Low | number:'1.0-0' }}</span>
                                  <span class="range52__bar">
                                    @if (week52Position(row) !== null) {
                                      <span class="range52__marker" [style.left.%]="week52Position(row)"></span>
                                    }
                                  </span>
                                  <span class="range52__hi">{{ row.metrics.week52High | number:'1.0-0' }}</span>
                                </span>
                              </span>
                            }
                          </div>
                        }
                        @if (row.recommendationLoading) {
                          <div class="reco reco--state">Loading analyst ratings…</div>
                        } @else if (row.recommendation && recoTotal(row.recommendation) > 0) {
                          <div class="reco" [title]="'Analyst recommendations (' + row.recommendation.period + ')'">
                            <span class="fstat__k">Analysts</span>
                            <span class="reco-bar">
                              @if (row.recommendation.strongBuy) {
                                <span class="reco-seg reco-seg--sb" [style.width.%]="row.recommendation.strongBuy / recoTotal(row.recommendation) * 100" [title]="'Strong Buy: ' + row.recommendation.strongBuy"></span>
                              }
                              @if (row.recommendation.buy) {
                                <span class="reco-seg reco-seg--b" [style.width.%]="row.recommendation.buy / recoTotal(row.recommendation) * 100" [title]="'Buy: ' + row.recommendation.buy"></span>
                              }
                              @if (row.recommendation.hold) {
                                <span class="reco-seg reco-seg--h" [style.width.%]="row.recommendation.hold / recoTotal(row.recommendation) * 100" [title]="'Hold: ' + row.recommendation.hold"></span>
                              }
                              @if (row.recommendation.sell) {
                                <span class="reco-seg reco-seg--s" [style.width.%]="row.recommendation.sell / recoTotal(row.recommendation) * 100" [title]="'Sell: ' + row.recommendation.sell"></span>
                              }
                              @if (row.recommendation.strongSell) {
                                <span class="reco-seg reco-seg--ss" [style.width.%]="row.recommendation.strongSell / recoTotal(row.recommendation) * 100" [title]="'Strong Sell: ' + row.recommendation.strongSell"></span>
                              }
                            </span>
                            <span class="reco-counts">
                              <span class="reco-counts__buy">{{ row.recommendation.strongBuy + row.recommendation.buy }} Buy</span>
                              <span class="reco-counts__hold">{{ row.recommendation.hold }} Hold</span>
                              <span class="reco-counts__sell">{{ row.recommendation.sell + row.recommendation.strongSell }} Sell</span>
                              <span class="reco-counts__total">({{ recoTotal(row.recommendation) }})</span>
                            </span>
                          </div>
                        }
                        <app-chart
                          [data]="row.chartData"
                          [color]="'#4a9eff'"
                          [candleData]="row.candleData"
                          [showCandles]="row.range === '1D' || row.range === '5D' || row.range === '1M'"
                          [maData]="row.maData"
                          [showMovingAverage]="row.showMovingAverage"
                          [ma150Data]="row.ma150Data"
                          [showMovingAverage150]="row.showMovingAverage150"
                          [volumeData]="row.volumeData"
                          [volumeProfileData]="row.volumeProfileData"
                          [showRangeLines]="row.showRangeLevels && row.range === '5D'"
                          [rangeHigh]="row.rangeHigh"
                          [rangeLow]="row.rangeLow"
                          [swingHigh]="row.swingHigh"
                          [swingLow]="row.swingLow"
                          [showOpeningRange]="openingRangeSymbols().has(row.symbol) && row.range === '1D'"
                          [openingRangeHigh]="openingRangeHighFor(row)"
                          [openingRangeLow]="openingRangeLowFor(row)"
                          [showSessionShade]="row.range === '1D'"
                          [sessionShadeUntil]="row.sessionShadeUntil"
                          [peerData]="row.peerData"
                          [showPeer]="peerSymbols().has(row.symbol)"
                          [showMacd]="macdSymbols().has(row.symbol)"
                          [fillHeight]="fullscreenSymbol() === row.symbol"
                        ></app-chart>
                      </div>
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
          @if (hasCostBasis()) {
            <tfoot>
              <tr class="summary-row">
                <td colspan="8">Portfolio Totals</td>
                <td></td>
                <td></td>
                <td></td>
                <td class="price">{{'$'}}{{ portfolioTotalCost() | number:'1.2-2' }}</td>
                <td class="price">{{'$'}}{{ portfolioMarketValue() | number:'1.2-2' }}</td>
                <td></td>
                <td></td>
                <td class="change" [class.positive]="portfolioTotalGainLoss() >= 0" [class.negative]="portfolioTotalGainLoss() < 0">
                  {{ portfolioTotalGainLoss() >= 0 ? '+$' : '-$' }}{{ (portfolioTotalGainLoss() >= 0 ? portfolioTotalGainLoss() : -portfolioTotalGainLoss()) | number:'1.2-2' }}
                </td>
                <td class="change" [class.positive]="portfolioTotalGainLossPercent() >= 0" [class.negative]="portfolioTotalGainLossPercent() < 0">
                  {{ portfolioTotalGainLossPercent() >= 0 ? '+' : '' }}{{ portfolioTotalGainLossPercent() | number:'1.2-2' }}%
                </td>
                <td></td>
              </tr>
            </tfoot>
          }
        </table>
        @if (newsPanelOpen()) {
          <aside class="news-panel" role="dialog" aria-modal="false" [attr.aria-labelledby]="newsPanelTitleId()">
            <header class="news-panel__header">
              <div>
                <p class="news-panel__eyebrow">Ticker brief</p>
                <h3 [id]="newsPanelTitleId()">{{ newsSymbol() }} News</h3>
              </div>
              <button type="button" class="news-panel__close" (click)="closeNewsPanel()" aria-label="Close documentation panel">✕</button>
            </header>
            <div class="news-panel__content">
              @if (newsLoading()) {
                <p class="news-panel__state">Loading recent items...</p>
              } @else if (newsLoadError()) {
                <p class="news-panel__state news-panel__state--error">{{ newsLoadError() }}</p>
              } @else if (newsArticles().length) {
                @for (article of newsArticles(); track article.url) {
                  <article class="news-item">
                    @if (article.image) {
                      <img class="news-item__image" [src]="article.image" [alt]="article.headline" loading="lazy" />
                    }
                    <div class="news-item__body">
                      <a
                        class="news-item__headline"
                        [href]="article.url"
                        target="_blank"
                        rel="noopener noreferrer"
                      >{{ article.headline }}</a>
                      <p class="news-item__summary">{{ article.summary || 'No summary available.' }}</p>
                      <div class="news-item__meta-row">
                        <span class="news-item__source">{{ article.source }}</span>
                        <span class="news-item__age">{{ relativeTime(article.datetime) }}</span>
                        <a
                          class="news-item__open"
                          [href]="article.url"
                          target="_blank"
                          rel="noopener noreferrer"
                          [attr.aria-label]="'Open story for ' + article.headline"
                        >Open ↗</a>
                      </div>
                    </div>
                  </article>
                }
              } @else {
                <p class="news-panel__state">No recent news found for {{ newsSymbol() }}.</p>
              }
            </div>
          </aside>
        }
      } @else {
        <p class="loading">No items found.</p>
      }
    </div>
  `,
  styles: [`
    .watchlist-section {
      margin-top: 32px;
    }
    h2 {
      color: #e0e0e0;
      margin: 0 0 20px;
      font-size: 22px;
    }
    .loading {
      color: #8892b0;
      font-size: 14px;
    }
    .watchlist-form {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .input-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
    }
    .input-wrapper .watchlist-input {
      padding-right: 28px;
    }
    .clear-btn {
      position: absolute;
      right: 6px;
      background: transparent;
      border: none;
      color: #8892b0;
      font-size: 13px;
      cursor: pointer;
      padding: 2px 4px;
      line-height: 1;
    }
    .clear-btn:hover {
      color: #dc3545;
    }
    .add-error {
      color: #dc3545;
      font-size: 13px;
      margin: -8px 0 12px;
    }
    .watchlist-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .io-buttons {
      display: flex;
      gap: 6px;
    }
    .io-btn {
      background: #1a2744;
      color: #8892b0;
      border: 1px solid #2a3a5e;
    }
    .io-btn:hover {
      color: #e0e0e0;
      border-color: #4a9eff;
    }
    .import-label {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
    }
    .watchlist-input {
      background: #0f1a30;
      border: 1px solid #2a3a5e;
      border-radius: 6px;
      color: #e0e0e0;
      padding: 8px 12px;
      font-size: 14px;
      width: 200px;
      outline: none;
    }
    .holding-input {
      width: 140px;
    }
    .watchlist-input:focus {
      border-color: #4a9eff;
    }
    .watchlist-input::placeholder {
      color: #5a6a8a;
    }
    .watchlist-btn {
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
    }
    .watchlist-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .add-btn {
      background: #28a745;
      color: #fff;
    }
    .add-btn:hover:not(:disabled) {
      background: #218838;
    }
    .remove-btn {
      background: transparent;
      color: #dc3545;
      padding: 4px 8px;
      font-size: 14px;
    }
    .remove-btn:hover {
      background: rgba(220, 53, 69, 0.1);
    }
    .watchlist-table {
      width: 100%;
      border-collapse: collapse;
      background: #16213e;
      border-radius: 10px;
      border: 1px solid #2a3a5e;
    }
    .watchlist-table th {
      text-align: left;
      padding: 12px 16px;
      color: #8892b0;
      font-size: 13px;
      font-weight: 600;
      border-bottom: 1px solid #2a3a5e;
      background: #0f1a30;
      position: sticky;
      top: 49px;
      z-index: 40;
    }
    .watchlist-table th.sortable {
      cursor: pointer;
      user-select: none;
    }
    .watchlist-table th.sortable:hover {
      color: #e0e0e0;
    }
    .sort-icon {
      font-size: 11px;
      margin-left: 4px;
      opacity: 0.7;
    }
    .watchlist-table td {
      padding: 12px 16px;
      color: #e0e0e0;
      font-size: 14px;
      border-bottom: 1px solid #2a3a5e;
    }
    .watchlist-table tr:last-child td {
      border-bottom: none;
    }
    .watchlist-table .symbol {
      font-weight: 600;
      color: #4a9eff;
    }
    .watchlist-table .name {
      color: #a0a0b0;
    }
    .watchlist-table .sector {
      color: #8892b0;
      font-size: 13px;
    }
    .watchlist-table .positive {
      color: #28a745;
    }
    .watchlist-table .negative {
      color: #dc3545;
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
    .range-btn.ma50-btn {
      border-color: rgba(240, 192, 64, 0.55);
      color: #f0c040;
    }
    .range-btn.ma50-btn:hover {
      border-color: #f0c040;
      color: #f6d16d;
    }
    .range-btn.ma50-btn.active {
      background: #f0c040;
      border-color: #f0c040;
      color: #1a1a2e;
    }
    .range-btn.ma150-btn {
      border-color: rgba(176, 124, 255, 0.6);
      color: #b07cff;
    }
    .range-btn.ma150-btn:hover {
      border-color: #b07cff;
      color: #c7a0ff;
    }
    .range-btn.ma150-btn.active {
      background: #b07cff;
      border-color: #b07cff;
      color: #fff;
    }
    .clickable-row {
      cursor: pointer;
      transition: background 0.15s;
    }
    .clickable-row:hover {
      background: rgba(74, 158, 255, 0.08);
    }
    .clickable-row.expanded {
      background: rgba(74, 158, 255, 0.12);
    }
    .chart-row td {
      padding: 0 16px 12px !important;
      border-bottom: 1px solid #2a3a5e;
    }
    .chart-loading {
      color: #8892b0;
      font-size: 13px;
      padding: 20px 0;
      text-align: center;
    }
    .chart-panel {
      display: flex;
      flex-direction: column;
    }
    .chart-panel.fullscreen {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: #1a1a2e;
      padding: 12px 16px 16px;
      gap: 8px;
      overflow: hidden;
    }
    .chart-panel.fullscreen app-chart {
      flex: 1;
      min-height: 0;
      display: block;
    }
    .chart-toolbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-start;
      align-items: center;
      gap: 6px;
      padding: 8px 0 4px;
    }
    .chart-toolbar .chart-title {
      font-weight: 700;
      color: #4a9eff;
      font-size: 15px;
      margin-right: 4px;
    }
    .chart-toolbar .chart-title__name {
      color: #8892b0;
      font-weight: 500;
      font-size: 12px;
      margin-left: 6px;
    }
    .chart-toolbar .etf-badge {
      border: 1px solid #8892b0;
      border-radius: 5px;
      color: #8892b0;
      padding: 1px 6px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(136, 146, 176, 0.08);
    }
    .chart-toolbar .fullscreen-btn {
      margin-left: auto;
      border-color: rgba(74, 158, 255, 0.55);
      color: #4a9eff;
    }
    .chart-toolbar .fullscreen-btn:hover {
      border-color: #4a9eff;
      color: #7bb8ff;
    }
    .fundamentals {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 2px 0 8px;
    }
    .fundamentals--state {
      color: #8892b0;
      font-size: 12px;
      padding: 4px 0 10px;
    }
    .fstat {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #0f1a30;
      border: 1px solid #2a3a5e;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 12px;
      color: #e0e0e0;
      white-space: nowrap;
    }
    .fstat__k {
      color: #8892b0;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .fstat.positive { color: #28a745; }
    .fstat.negative { color: #dc3545; }
    .fstat--range {
      gap: 8px;
    }
    .range52 {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #8892b0;
    }
    .range52__bar {
      position: relative;
      width: 70px;
      height: 4px;
      border-radius: 2px;
      background: linear-gradient(to right, #dc3545, #f0c040, #28a745);
    }
    .range52__marker {
      position: absolute;
      top: -3px;
      width: 2px;
      height: 10px;
      background: #e0e0e0;
      border-radius: 1px;
      transform: translateX(-1px);
    }
    .reco {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 0 10px;
      font-size: 12px;
    }
    .reco--state {
      color: #8892b0;
    }
    .reco-bar {
      display: inline-flex;
      width: 180px;
      height: 10px;
      border-radius: 5px;
      overflow: hidden;
      border: 1px solid #2a3a5e;
      background: #0f1a30;
    }
    .reco-seg { height: 100%; }
    .reco-seg--sb { background: #1a7f37; }
    .reco-seg--b  { background: #28a745; }
    .reco-seg--h  { background: #8892b0; }
    .reco-seg--s  { background: #dc3545; }
    .reco-seg--ss { background: #a11221; }
    .reco-counts {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      color: #8892b0;
    }
    .reco-counts__buy { color: #28a745; font-weight: 600; }
    .reco-counts__hold { color: #a0a0b0; font-weight: 600; }
    .reco-counts__sell { color: #dc3545; font-weight: 600; }
    .reco-counts__total { color: #5a6a8a; }
    .split-btn {
      display: inline-flex;
    }
    .split-btn > .range-btn {
      border-radius: 0;
    }
    .split-btn > .range-btn:first-child {
      border-radius: 6px 0 0 6px;
    }
    .split-btn > .range-btn:last-child {
      border-radius: 0 6px 6px 0;
      margin-left: -1px;
    }
    .split-btn > .range-btn:only-child {
      border-radius: 6px;
      margin-left: 0;
    }
    .split-btn > .range-btn.active {
      position: relative;
      z-index: 1;
    }
    .shares {
      color: #a0a0b0;
      font-size: 13px;
    }
    .volume {
      color: #8892b0;
      font-size: 13px;
    }
    .summary-row td {
      padding: 12px 16px;
      font-weight: 700;
      color: #e0e0e0;
      border-top: 2px solid #4a9eff;
      background: #0f1a30;
      font-size: 14px;
    }
  `]
})
export class WatchlistComponent implements OnInit {
  private alpacaService = inject(AlpacaService);
  private fmpService = inject(FmpService);
  private finnhubService = inject(FinnhubService);
  private notificationService = inject(NotificationService);
  private watchlistService = inject(WatchlistService);

  title = input.required<string>();
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
  fullscreenSymbol = signal<string | null>(null);
  readonly timeRanges: TimeRange[] = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'All'];
  openingRangeSymbols = signal<Set<string>>(new Set());
  openingRangeNarrowSymbols = signal<Set<string>>(new Set());
  readonly newsPanelOpen = signal(false);
  readonly newsSymbol = signal<string>('');
  readonly newsArticles = signal<FinnhubNewsArticle[]>([]);
  readonly newsLoading = signal(false);
  readonly newsLoadError = signal<string | null>(null);

  private newsRequestSeq = 0;

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
        return { symbol, name, sector, price, change, changePercent, pegy: null, pegyLoading: false, pegyLoaded: false, dividendYield: this.#dividendYield(symbol, price), volume, costBasis, shares, totalCost, marketValue, gainLoss, gainLossPercent, totalGainLoss, totalGainLossPercent, chartData: [], candleData: [], chartLoading: false, maData: [], ma150Data: [], volumeData: [], volumeProfileData: [], rangeHigh: null, rangeLow: null, swingHigh: null, swingLow: null, openingRangeHigh: null, openingRangeLow: null, sessionShadeUntil: null, range: '1D', showMovingAverage: false, showMovingAverage150: false, showRangeLevels: false, peerSymbol: null, peerName: null, peerData: [], peerLoading: false, metrics: null, metricsLoading: false, recommendation: null, recommendationLoading: false };
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
    return { symbol, name, sector, price, change, changePercent, pegy: null, pegyLoading: false, pegyLoaded: false, dividendYield: this.#dividendYield(symbol, price), volume, costBasis, shares, totalCost, marketValue, gainLoss, gainLossPercent, totalGainLoss, totalGainLossPercent, chartData: [], candleData: [], chartLoading: false, maData: [], ma150Data: [], volumeData: [], volumeProfileData: [], rangeHigh: null, rangeLow: null, swingHigh: null, swingLow: null, openingRangeHigh: null, openingRangeLow: null, sessionShadeUntil: null, range: '1D', showMovingAverage: false, showMovingAverage150: false, showRangeLevels: false, peerSymbol: null, peerName: null, peerData: [], peerLoading: false, metrics: null, metricsLoading: false, recommendation: null, recommendationLoading: false };
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
        maData: [],
        ma150Data: [],
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
        showMovingAverage: false,
        showMovingAverage150: false,
        showRangeLevels: false,
        peerSymbol: null,
        peerName: null,
        peerData: [],
        peerLoading: false,
        metrics: null,
        metricsLoading: false,
        recommendation: null,
        recommendationLoading: false,
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

  toggleMovingAverage150(symbol: string): void {
    const row = this.watchlistRows().find(r => r.symbol === symbol);
    if (!row) return;
    this.patchRow(symbol, { showMovingAverage150: !row.showMovingAverage150 });
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

  private async loadChart(symbol: string): Promise<void> {
    this.watchlistRows.update(rows => rows.map(r =>
      r.symbol === symbol ? { ...r, chartLoading: true, chartData: [] } : r
    ));

    const range = this.watchlistRows().find(r => r.symbol === symbol)?.range ?? '1D';
    const config = RANGE_CONFIGS[range];
    const isIntraday = range === '1D' || range === '5D' || range === '1M';

    try {
      const result = await firstValueFrom(
        this.alpacaService.getBars(symbol, config.timeframe, config.getStart(), undefined, range === '1D' ? 5000 : 1000)
      );
      const rawBars = result?.body?.bars ?? [];
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
          maData,
          ma150Data,
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
