import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { FmpService } from '../../services/fmp.service';
import { WatchlistService } from '../../services/watchlist.service';
import { HighYieldStock } from '../../models/fmp.models';
import { SECTOR_SYMBOLS } from '../../data/sector-symbols';

interface HighYieldCache {
  date: string;
  rows: HighYieldStock[];
}

const CACHE_KEY = 'high_yield_cache';
const MAX_ROWS = 50;

@Component({
  selector: 'app-high-yield',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="hy-page">
      <h2>High Yield</h2>
      <p class="subtitle">
        Highest dividend yields among large-cap stocks across sectors (ETFs/funds excluded).
        Yield = annual dividend ÷ price. Sourced from the sector screener and cached for the day.
      </p>

      <div class="hy-actions">
        <span class="as-of">{{ asOf() ? ('As of ' + asOf()) : '' }}</span>
        <button class="load-btn" (click)="refresh()" [disabled]="loading()">
          {{ loading() ? 'Loading…' : 'Refresh' }}
        </button>
      </div>

      @if (loading()) { <p class="loading">Screening sectors…</p> }
      @if (error()) {
        <p class="loading">{{ error() }} <button class="load-btn" (click)="refresh()">Retry</button></p>
      }

      @if (!loading() && !error()) {
        @if (rows().length) {
          <table class="hy-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Company</th>
                <th>Sector</th>
                <th class="right">Price</th>
                <th class="right">Annual Div</th>
                <th class="right">Yield</th>
                <th class="right">Watch</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.symbol) {
                <tr>
                  <td class="symbol">{{ row.symbol }}</td>
                  <td class="name">{{ row.companyName }}</td>
                  <td class="sector">{{ row.sector }}</td>
                  <td class="right">{{ '$' + (row.price | number:'1.2-2') }}</td>
                  <td class="right">{{ '$' + (row.annualDividend | number:'1.2-2') }}</td>
                  <td class="right yield">{{ (row.yieldPct | number:'1.2-2') + '%' }}</td>
                  <td class="right">
                    <button
                      type="button"
                      class="add-watch-btn"
                      [class.added]="inWatchList(row.symbol)"
                      [disabled]="inWatchList(row.symbol)"
                      (click)="addToWatchList(row.symbol)"
                      [title]="inWatchList(row.symbol) ? 'In Watch List' : 'Add to Watch List'"
                    >{{ inWatchList(row.symbol) ? '✓' : '+' }}</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="loading">No dividend-paying stocks found (the free-tier screener may be limited for some sectors).</p>
        }
      }
    </div>
  `,
  styles: [`
    .hy-page { padding: 24px; }
    h2 { color: #e0e0e0; margin: 0 0 6px; font-size: 22px; }
    .subtitle { color: #8892b0; font-size: 13px; margin: 0 0 16px; max-width: 680px; }
    .hy-actions { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .as-of { color: #8892b0; font-size: 12px; }
    .loading { color: #8892b0; font-size: 14px; }
    .load-btn { background: #4a9eff; color: #fff; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .load-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .hy-table { width: 100%; border-collapse: collapse; background: #16213e; border-radius: 10px; border: 1px solid #2a3a5e; overflow: hidden; }
    .hy-table th { text-align: left; padding: 12px 16px; color: #8892b0; font-size: 13px; font-weight: 600; border-bottom: 1px solid #2a3a5e; background: #0f1a30; }
    .hy-table th.right { text-align: right; }
    .hy-table td { padding: 12px 16px; color: #e0e0e0; font-size: 14px; border-bottom: 1px solid #2a3a5e; }
    .hy-table tr:last-child td { border-bottom: none; }
    .right { text-align: right; }
    .symbol { font-weight: 600; color: #4a9eff; }
    .name { color: #a0a0b0; }
    .sector { color: #8892b0; font-size: 13px; }
    .yield { font-weight: 700; color: #28a745; }
    .add-watch-btn { border: 1px solid #28a745; border-radius: 5px; background: transparent; color: #28a745; width: 20px; height: 20px; line-height: 1; font-size: 14px; font-weight: 700; cursor: pointer; padding: 0; }
    .add-watch-btn:hover:not(:disabled) { background: rgba(40, 167, 69, 0.12); }
    .add-watch-btn.added { color: #8892b0; border-color: #2a3a5e; cursor: default; }
  `]
})
export class HighYieldComponent implements OnInit {
  private fmp = inject(FmpService);
  private watchlistService = inject(WatchlistService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly rows = signal<HighYieldStock[]>([]);
  readonly asOf = signal('');

  ngOnInit(): void {
    const cached = this.#readCache();
    if (cached && cached.date === this.#today()) {
      this.rows.set(cached.rows);
      this.asOf.set(new Date().toLocaleDateString());
    } else {
      this.load();
    }
  }

  refresh(): void {
    this.load();
  }

  addToWatchList(symbol: string): void {
    this.watchlistService.addSymbol('Watch List', symbol);
  }

  inWatchList(symbol: string): boolean {
    this.watchlistService.version('Watch List')(); // reactive dependency
    return this.watchlistService.has('Watch List', symbol);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const sectors = Object.keys(SECTOR_SYMBOLS);
      const all = await firstValueFrom(this.fmp.getHighYieldStocks(sectors));
      const rows = all.slice(0, MAX_ROWS);
      this.rows.set(rows);
      this.asOf.set(new Date().toLocaleDateString());
      this.#writeCache({ date: this.#today(), rows });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load high-yield stocks.');
    } finally {
      this.loading.set(false);
    }
  }

  #today(): string {
    return new Date().toISOString().split('T')[0];
  }

  #readCache(): HighYieldCache | null {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) as HighYieldCache : null;
    } catch {
      return null;
    }
  }

  #writeCache(cache: HighYieldCache): void {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore quota errors
    }
  }
}
