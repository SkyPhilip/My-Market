import { Component, OnInit, OnDestroy, computed, signal, inject, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AlpacaService } from '../../services/alpaca.service';
import { FmpService } from '../../services/fmp.service';
import { ChartComponent } from '../chart/chart.component';
import { fetchFnWithState } from '../../utils/fetch-rx';
import { AlpacaBarsResponse, AlpacaErrorBody, AlpacaSnapshotsResponse, AlpacaWatchlist, AlpacaSnapshot } from '../../models/alpaca.models';
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

interface WatchlistRow {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
}

type SortColumn = 'symbol' | 'name' | 'sector' | 'price' | 'change' | 'changePercent';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ChartComponent],
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

      <div class="watchlist-section">
        <h2>Watchlist</h2>
        <form class="watchlist-form" (submit)="addSymbol($event)">
          <input
            type="text"
            [(ngModel)]="newSymbol"
            name="symbol"
            placeholder="Add ticker (e.g. AAPL)"
            class="watchlist-input"
            [disabled]="adding()"
          />
          <button type="submit" class="watchlist-btn add-btn" [disabled]="!newSymbol.trim() || adding()">Add</button>
        </form>
        @if (watchlistState().prefetchOrBusy) {
          <p class="loading">Loading watchlist...</p>
        } @else if (watchlistState().errorResOrException) {
          <p class="loading">Failed to load watchlist. <button (click)="loadWatchlist()">Retry</button></p>
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (row of sortedWatchlistRows(); track row.symbol) {
                <tr>
                  <td class="symbol">{{ row.symbol }}</td>
                  <td class="name">{{ row.name }}</td>
                  <td class="sector">{{ row.sector }}</td>
                  <td class="price">{{ row.price !== null ? ('$' + (row.price | number:'1.2-2')) : '—' }}</td>
                  <td class="change" [class.positive]="(row.change ?? 0) >= 0" [class.negative]="(row.change ?? 0) < 0">
                    {{ row.change !== null ? ((row.change >= 0 ? '+' : '') + (row.change | number:'1.2-2')) : '—' }}
                  </td>
                  <td class="change" [class.positive]="(row.changePercent ?? 0) >= 0" [class.negative]="(row.changePercent ?? 0) < 0">
                    {{ row.changePercent !== null ? ((row.changePercent >= 0 ? '+' : '') + (row.changePercent | number:'1.2-2') + '%') : '—' }}
                  </td>
                  <td><button class="watchlist-btn remove-btn" (click)="removeSymbol(row.symbol)">✕</button></td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="loading">No watchlist items found.</p>
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
    .watchlist-section {
      margin-top: 32px;
    }
    .watchlist-form {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
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
      overflow: hidden;
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
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  private alpacaService = inject(AlpacaService);
  private fmpService = inject(FmpService);
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly REFRESH_MS = 15 * 60 * 1000;

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

  fetchWatchlists = fetchFnWithState<AlpacaWatchlist[], AlpacaErrorBody>(() =>
    this.alpacaService.getWatchlists()
  );

  fetchWatchlistSnapshots = fetchFnWithState<AlpacaSnapshotsResponse, AlpacaErrorBody, string[]>((symbols: string[]) =>
    this.alpacaService.getSnapshots(symbols)
  );

  watchlistState = computed(() => {
    const wl = this.fetchWatchlists.state();
    const snap = this.fetchWatchlistSnapshots.state();
    return {
      prefetchOrBusy: wl.prefetchOrBusy || snap.busy,
      errorResOrException: wl.errorResOrException ?? snap.errorResOrException,
    };
  });

  watchlistRows: WritableSignal<WatchlistRow[]> = signal<WatchlistRow[]>([]);
  newSymbol = '';
  adding = signal(false);
  private watchlistId: string | null = null;

  sortColumn = signal<SortColumn | null>(null);
  sortDirection = signal<SortDirection>('asc');

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

  ngOnInit(): void {
    this.loadMarketSummary();
    this.loadCharts();
    this.loadWatchlist();
    this.refreshInterval = setInterval(() => {
      this.loadMarketSummary();
      this.loadCharts();
      this.loadWatchlist();
    }, DashboardComponent.REFRESH_MS);
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
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
        const chartData: LineData<Time>[] = rawBars.map(bar => {
          const barDate = new Date(bar.t);
          const tzOffsetSec = barDate.getTimezoneOffset() * 60;
          return {
            time: (Math.floor(barDate.getTime() / 1000) - tzOffsetSec) as Time,
            value: bar.c
          };
        });
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

  async loadWatchlist(): Promise<void> {
    const wlResult = await this.fetchWatchlists();
    let watchlist: AlpacaWatchlist | undefined;

    if (wlResult.okRes?.body?.length) {
      // List endpoint doesn't include assets — fetch the full watchlist by ID
      const id = wlResult.okRes.body[0].id;
      const detail = await firstValueFrom(this.alpacaService.getWatchlist(id));
      if (detail?.ok && detail.body) {
        watchlist = detail.body;
      }
    } else if (wlResult.okRes) {
      const defaultSymbols = ['CEG', 'XLE', 'SLV', 'COPX', 'CRWV', 'GLD', 'GOOGL', 'MSFT', 'NVDA', 'PLTR'];
      const createResult = await firstValueFrom(this.alpacaService.createWatchlist('My Watchlist', defaultSymbols));
      if (createResult?.ok && createResult.body) {
        watchlist = createResult.body;
      }
    }

    if (!watchlist) {
      this.watchlistRows.set([]);
      return;
    }

    this.watchlistId = watchlist.id;

    if (!watchlist.assets?.length) {
      this.watchlistRows.set([]);
      return;
    }

    const symbols = watchlist.assets.map(a => a.symbol);

    // Fetch sectors from FMP for symbols not yet cached
    const uncachedSymbols = symbols.filter(s => !this.fmpService.getCachedSector(s));
    if (uncachedSymbols.length) {
      try {
        await firstValueFrom(this.fmpService.getProfiles(uncachedSymbols));
      } catch {
        // FMP lookup failed — continue without sector data
      }
    }

    const snapResult = await this.fetchWatchlistSnapshots(symbols);
    if (!snapResult.okRes?.body) return;

    const snapshots = snapResult.okRes.body;
    const rows: WatchlistRow[] = watchlist.assets.map(asset => {
      const snap: AlpacaSnapshot | undefined = snapshots[asset.symbol];
      const price = snap?.latestTrade?.p ?? snap?.minuteBar?.c ?? null;
      const prevClose = snap?.prevDailyBar?.c ?? null;
      const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
      const changePercent = price && prevClose ? +((change! / prevClose) * 100).toFixed(2) : null;
      const sector = this.fmpService.getCachedSector(asset.symbol) ?? '\u2014';
      return { symbol: asset.symbol, name: asset.name, sector, price, change, changePercent };
    });
    this.watchlistRows.set(rows);
  }

  async addSymbol(event: Event): Promise<void> {
    event.preventDefault();
    const symbol = this.newSymbol.trim().toUpperCase();
    if (!symbol || !this.watchlistId) return;

    if (this.watchlistRows().some(r => r.symbol === symbol)) {
      this.newSymbol = '';
      return;
    }

    this.adding.set(true);
    try {
      const result = await firstValueFrom(this.alpacaService.addToWatchlist(this.watchlistId, symbol));
      if (result?.ok && result.body) {
        this.newSymbol = '';
        const addedAsset = result.body.assets.find(a => a.symbol === symbol);
        if (addedAsset) {
          // Fetch snapshot and sector for the new symbol
          const [snapResult] = await Promise.all([
            firstValueFrom(this.alpacaService.getSnapshots([symbol])),
            this.fmpService.getCachedSector(symbol)
              ? Promise.resolve()
              : firstValueFrom(this.fmpService.getProfiles([symbol])),
          ]);
          const snap = snapResult?.body?.[symbol];
          const price = snap?.latestTrade?.p ?? snap?.minuteBar?.c ?? null;
          const prevClose = snap?.prevDailyBar?.c ?? null;
          const change = price && prevClose ? +(price - prevClose).toFixed(2) : null;
          const changePercent = price && prevClose ? +((change! / prevClose) * 100).toFixed(2) : null;
          const sector = this.fmpService.getCachedSector(symbol) ?? '\u2014';
          this.watchlistRows.update(rows => [...rows, { symbol: addedAsset.symbol, name: addedAsset.name, sector, price, change, changePercent }]);
        }
      }
    } finally {
      this.adding.set(false);
    }
  }

  async removeSymbol(symbol: string): Promise<void> {
    if (!this.watchlistId) return;
    const result = await firstValueFrom(this.alpacaService.removeFromWatchlist(this.watchlistId, symbol));
    if (result?.ok) {
      this.watchlistRows.update(rows => rows.filter(r => r.symbol !== symbol));
    }
  }
}
