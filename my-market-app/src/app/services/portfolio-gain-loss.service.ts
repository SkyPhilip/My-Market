import { Injectable, signal } from '@angular/core';

export interface PortfolioGainLossSnapshot {
  timestamp: string;
  gains: number;
  losses: number;
}

const STORAGE_KEY = 'portfolio_gain_loss_history';
const MAX_SNAPSHOTS = 20000;

@Injectable({ providedIn: 'root' })
export class PortfolioGainLossService {
  private readonly _snapshots = signal<PortfolioGainLossSnapshot[]>(this.#load());
  readonly snapshots = this._snapshots.asReadonly();

  recordSnapshot(gains: number, losses: number, timestamp = new Date()): void {
    if (!Number.isFinite(gains) || !Number.isFinite(losses)) return;

    const snapshot = {
      timestamp: timestamp.toISOString(),
      gains: +gains.toFixed(2),
      losses: +losses.toFixed(2),
    };
    const snapshots = this._snapshots();
    const minute = Math.floor(timestamp.getTime() / 60000);
    const last = snapshots[snapshots.length - 1];
    const next = last && Math.floor(new Date(last.timestamp).getTime() / 60000) === minute
      ? [...snapshots.slice(0, -1), snapshot]
      : [...snapshots, snapshot].slice(-MAX_SNAPSHOTS);

    this._snapshots.set(next);
    this.#save(next);
  }

  #load(): PortfolioGainLossSnapshot[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((row): row is PortfolioGainLossSnapshot =>
        typeof row?.timestamp === 'string' && Number.isFinite(Date.parse(row.timestamp)) &&
        typeof row?.gains === 'number' && Number.isFinite(row.gains) &&
        typeof row?.losses === 'number' && Number.isFinite(row.losses)
      ).slice(-MAX_SNAPSHOTS);
    } catch {
      return [];
    }
  }

  #save(snapshots: PortfolioGainLossSnapshot[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
    } catch {
      // Keep the in-memory chart working if browser storage is unavailable or full.
    }
  }
}