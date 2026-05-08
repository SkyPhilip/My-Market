import { Component, OnInit, computed, signal, inject, input, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AlpacaService } from '../../services/alpaca.service';
import { FmpService } from '../../services/fmp.service';
import { fetchFnWithState } from '../../utils/fetch-rx';
import { AlpacaErrorBody, AlpacaSnapshotsResponse, AlpacaSnapshot } from '../../models/alpaca.models';

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
  selector: 'app-watchlist',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="watchlist-section">
      <h2>{{ title() }}</h2>
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
export class WatchlistComponent implements OnInit {
  private http = inject(HttpClient);
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
      prefetchOrBusy: this.loading() || snap.busy,
      errorResOrException: snap.errorResOrException,
    };
  });

  private loading = signal(true);
  private symbols = signal<string[]>([]);
  watchlistRows: WritableSignal<WatchlistRow[]> = signal<WatchlistRow[]>([]);
  newSymbol = '';
  adding = signal(false);

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

  async loadWatchlist(): Promise<void> {
    this.loading.set(true);
    try {
      const config = await firstValueFrom(this.http.get<Record<string, string[]>>('watchlists.json'));
      const initialSymbols = config?.[this.watchlistName()] ?? [];
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
        return { symbol, name: symbol, sector, price, change, changePercent };
      });
      this.watchlistRows.set(rows);
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
      this.watchlistRows.update(rows => [...rows, { symbol, name: symbol, sector, price, change, changePercent }]);
      this.newSymbol = '';
    } finally {
      this.adding.set(false);
    }
  }

  removeSymbol(symbol: string): void {
    this.symbols.update(s => s.filter(sym => sym !== symbol));
    this.watchlistRows.update(rows => rows.filter(r => r.symbol !== symbol));
  }
}
