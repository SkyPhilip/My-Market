import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HistoryService, HistoryRecord } from '../../services/history.service';
import { PLATFORMS, platformById } from '../../data/platforms';

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './history.component.html',
  styleUrl: './history.component.scss',
})
export class HistoryComponent {
  private historyService = inject(HistoryService);

  /** Sold holdings, most recently sold first. */
  readonly rows = computed(() =>
    [...this.historyService.records()].sort((a, b) => b.soldAt.localeCompare(a.soldAt))
  );

  readonly totalGainLoss = computed(() =>
    this.rows().reduce((sum, r) => sum + (r.totalGainLoss ?? 0), 0)
  );

  readonly totalCost = computed(() =>
    this.rows().reduce((sum, r) => sum + (r.totalCost ?? 0), 0)
  );

  readonly totalGainLossPercent = computed(() => {
    const cost = this.totalCost();
    return cost ? +((this.totalGainLoss() / cost) * 100).toFixed(2) : 0;
  });

  readonly platformGainLossTotals = computed(() => {
    const totals = new Map<string | null, number>();
    for (const row of this.rows()) {
      const platformId = platformById(row.platform)?.id ?? null;
      totals.set(platformId, (totals.get(platformId) ?? 0) + (row.totalGainLoss ?? 0));
    }

    return [
      ...PLATFORMS.filter(platform => totals.has(platform.id)).map(platform => ({
        id: platform.id,
        label: platform.label,
        color: platform.color,
        totalGainLoss: +(totals.get(platform.id) ?? 0).toFixed(2),
      })),
      ...(totals.has(null) ? [{
        id: null,
        label: 'Unassigned',
        color: null,
        totalGainLoss: +(totals.get(null) ?? 0).toFixed(2),
      }] : []),
    ];
  });

  platformColor(id: string | null | undefined): string | null {
    return platformById(id)?.color ?? null;
  }

  platformTitle(id: string | null | undefined): string {
    const platform = platformById(id);
    return platform ? `Held at ${platform.label}` : '';
  }

  daysHeld(row: HistoryRecord): number | null {
    if (!row.addedAt || !row.soldAt) return null;
    const bought = new Date(row.addedAt);
    const sold = new Date(row.soldAt);
    if (!Number.isFinite(bought.getTime()) || !Number.isFinite(sold.getTime())) return null;
    const boughtDay = Date.UTC(bought.getUTCFullYear(), bought.getUTCMonth(), bought.getUTCDate());
    const soldDay = Date.UTC(sold.getUTCFullYear(), sold.getUTCMonth(), sold.getUTCDate());
    const days = (soldDay - boughtDay) / 86_400_000;
    return days >= 0 ? days : null;
  }

  remove(id: string): void {
    this.historyService.removeRecord(id);
  }

  /** Applies an edited sell price (from the inline input), recomputing derived columns and totals. */
  updateSellPrice(id: string, value: string): void {
    const parsed = Number(value);
    this.historyService.updateSellPrice(id, value.trim() !== '' && Number.isFinite(parsed) ? parsed : null);
  }

  /** Applies an edited sold date (from the inline date input, `YYYY-MM-DD`). */
  updateSoldAt(id: string, value: string): void {
    if (!value) return;
    const iso = new Date(value + 'T00:00:00').toISOString();
    this.historyService.updateSoldAt(id, iso);
  }

  /** Formats an ISO timestamp as `YYYY-MM-DD` for the date input's value. */
  toDateInputValue(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }

  clearAll(): void {
    if (confirm('Clear the entire holdings history? This cannot be undone.')) {
      this.historyService.clear();
    }
  }

  trackById(_index: number, row: HistoryRecord): string {
    return row.id;
  }
}
