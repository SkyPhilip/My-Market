import { Injectable, signal } from '@angular/core';

/** One closed-out holding lot, recorded when its row is removed from Current Holdings. */
export interface HistoryRecord {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  shares: number | null;
  costBasis: number | null;
  totalCost: number | null;
  /** Price per share at the moment the lot was removed (the effective sell price). */
  sellPrice: number | null;
  /** Market value at removal (sellPrice × shares). */
  proceeds: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
  totalGainLoss: number | null;
  /** ISO timestamp the lot was originally added to holdings (null for legacy lots). */
  addedAt: string | null;
  /** ISO timestamp the lot was removed/sold. */
  soldAt: string;
}

/**
 * Persists a log of past holdings in localStorage under `holdings_history`.
 * WatchlistComponent appends a record whenever a Current Holdings lot is removed;
 * HistoryComponent renders the log and totals the realized gains/losses.
 */
@Injectable({ providedIn: 'root' })
export class HistoryService {
  private static readonly KEY = 'holdings_history';
  readonly records = signal<HistoryRecord[]>(this.#load());

  addRecord(record: Omit<HistoryRecord, 'id' | 'soldAt'> & { soldAt?: string }): void {
    const full: HistoryRecord = { ...record, id: crypto.randomUUID(), soldAt: record.soldAt ?? new Date().toISOString() };
    this.records.update(rows => {
      const next = [...rows, full];
      this.#save(next);
      return next;
    });
  }

  removeRecord(id: string): void {
    this.records.update(rows => {
      const next = rows.filter(r => r.id !== id);
      this.#save(next);
      return next;
    });
  }

  /** Overrides a record's sell price and recomputes its proceeds and gain/loss figures. */
  updateSellPrice(id: string, sellPrice: number | null): void {
    this.records.update(rows => {
      const next = rows.map(r => r.id === id ? this.#withSellPrice(r, sellPrice) : r);
      this.#save(next);
      return next;
    });
  }

  #withSellPrice(record: HistoryRecord, sellPrice: number | null): HistoryRecord {
    const price = sellPrice !== null && Number.isFinite(sellPrice) ? +sellPrice.toFixed(2) : null;
    const proceeds = price !== null && record.shares !== null ? +(price * record.shares).toFixed(2) : null;
    const gainLoss = price !== null && record.costBasis !== null ? +(price - record.costBasis).toFixed(2) : null;
    const gainLossPercent = gainLoss !== null && record.costBasis ? +((gainLoss / record.costBasis) * 100).toFixed(2) : null;
    const totalGainLoss = proceeds !== null && record.totalCost !== null ? +(proceeds - record.totalCost).toFixed(2) : null;
    return { ...record, sellPrice: price, proceeds, gainLoss, gainLossPercent, totalGainLoss };
  }

  clear(): void {
    this.records.set([]);
    localStorage.removeItem(HistoryService.KEY);
  }

  #load(): HistoryRecord[] {
    const raw = localStorage.getItem(HistoryService.KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  #save(records: HistoryRecord[]): void {
    localStorage.setItem(HistoryService.KEY, JSON.stringify(records));
  }
}
