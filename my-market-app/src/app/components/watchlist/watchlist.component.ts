import { Component, OnInit, computed, signal, inject, input, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AlpacaService } from '../../services/alpaca.service';
import { FmpService } from '../../services/fmp.service';
import { fetchFnWithState } from '../../utils/fetch-rx';
import { AlpacaErrorBody, AlpacaBarsResponse, AlpacaSnapshotsResponse, AlpacaSnapshot } from '../../models/alpaca.models';
import { ChartComponent } from '../chart/chart.component';
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

interface WatchlistRow {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  costBasis: number | null;
  shares: number | null;
  totalCost: number | null;
  marketValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
  totalGainLoss: number | null;
  totalGainLossPercent: number | null;
  chartData: LineData<Time>[];
  chartLoading: boolean;
}

type SortColumn = 'symbol' | 'name' | 'sector' | 'price' | 'change' | 'changePercent' | 'costBasis' | 'shares' | 'totalCost' | 'marketValue' | 'gainLoss' | 'gainLossPercent' | 'totalGainLoss' | 'totalGainLossPercent';
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
        <div class="io-buttons">
          <button class="watchlist-btn io-btn" (click)="exportWatchlist()">Export</button>
          <label class="watchlist-btn io-btn import-label">
            Import
            <input type="file" accept=".json" (change)="importWatchlist($event)" hidden />
          </label>
        </div>
      </div>
      <div class="range-selector">
        @for (range of timeRanges; track range) {
          <button
            class="range-btn"
            [class.active]="selectedRange() === range"
            (click)="selectRange(range)"
          >{{ range }}</button>
        }
      </div>
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (row of sortedWatchlistRows(); track row.symbol) {
              <tr class="clickable-row" [class.expanded]="expandedSymbols().has(row.symbol)" (click)="toggleChart(row.symbol)">
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
                <td><button class="watchlist-btn remove-btn" (click)="removeSymbol(row.symbol); $event.stopPropagation()">✕</button></td>
              </tr>
              @if (expandedSymbols().has(row.symbol)) {
                <tr class="chart-row">
                  <td [attr.colspan]="hasCostBasis() ? 15 : 7">
                    @if (row.chartLoading) {
                      <p class="chart-loading">Loading chart...</p>
                    } @else {
                      <app-chart [data]="row.chartData" [color]="'#4a9eff'"></app-chart>
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
          @if (hasCostBasis()) {
            <tfoot>
              <tr class="summary-row">
                <td colspan="6">Portfolio Totals</td>
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
    .range-selector {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
      position: sticky;
      top: 49px;
      z-index: 50;
      background: #1a1a2e;
      padding: 8px 0;
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
    .shares {
      color: #a0a0b0;
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
  private symbols = signal<string[]>([]);
  watchlistRows: WritableSignal<WatchlistRow[]> = signal<WatchlistRow[]>([]);
  newSymbol = '';
  adding = signal(false);

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
  readonly timeRanges: TimeRange[] = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'All'];
  readonly selectedRange = signal<TimeRange>('1D');

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
    this.loadWatchlist();
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

      const uncachedSymbols = initialSymbols.filter(s => !this.fmpService.getCachedSector(s));
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
        return { symbol, name: symbol, sector, price, change, changePercent, costBasis, shares, totalCost, marketValue, gainLoss, gainLossPercent, totalGainLoss, totalGainLossPercent, chartData: [], chartLoading: false };
      });
      this.watchlistRows.set(rows);
      this.saveToStorage();
    } finally {
      this.loading.set(false);
    }
  }

  async addSymbol(event: Event): Promise<void> {
    event.preventDefault();
    const symbol = this.newSymbol.trim().toUpperCase();
    if (!symbol) return;

    if (this.symbols().includes(symbol)) {
      this.newSymbol = '';
      return;
    }

    this.adding.set(true);
    try {
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
      this.symbols.update(s => [...s, symbol]);
      this.watchlistRows.update(rows => [...rows, { symbol, name: symbol, sector, price, change, changePercent, costBasis: null, shares: null, totalCost: null, marketValue: null, gainLoss: null, gainLossPercent: null, totalGainLoss: null, totalGainLossPercent: null, chartData: [], chartLoading: false }]);
      this.newSymbol = '';
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
    }
  }

  selectRange(range: TimeRange): void {
    this.selectedRange.set(range);
    for (const symbol of this.expandedSymbols()) {
      this.loadChart(symbol);
    }
  }

  private async loadChart(symbol: string): Promise<void> {
    this.watchlistRows.update(rows => rows.map(r =>
      r.symbol === symbol ? { ...r, chartLoading: true, chartData: [] } : r
    ));

    const range = this.selectedRange();
    const config = RANGE_CONFIGS[range];
    const isIntraday = range === '1D' || range === '5D' || range === '1M';

    try {
      const result = await firstValueFrom(
        this.alpacaService.getBars(symbol, config.timeframe, config.getStart())
      );
      const rawBars = result?.body?.bars ?? [];
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
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, chartData, chartLoading: false } : r
      ));
    } catch {
      this.watchlistRows.update(rows => rows.map(r =>
        r.symbol === symbol ? { ...r, chartLoading: false } : r
      ));
    }
  }
}
