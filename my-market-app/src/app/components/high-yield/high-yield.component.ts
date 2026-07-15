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
const MAX_ROWS = 10;

@Component({
  selector: 'app-high-yield',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './high-yield.component.html',
  styleUrl: './high-yield.component.scss',
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
      const symbols = Object.values(SECTOR_SYMBOLS).flat();
      const all = await firstValueFrom(this.fmp.getHighYieldStocks(symbols));
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
