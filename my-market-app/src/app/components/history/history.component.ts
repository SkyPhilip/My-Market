import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HistoryService, HistoryRecord } from '../../services/history.service';

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

  remove(id: string): void {
    this.historyService.removeRecord(id);
  }

  /** Applies an edited sell price (from the inline input), recomputing derived columns and totals. */
  updateSellPrice(id: string, value: string): void {
    const parsed = Number(value);
    this.historyService.updateSellPrice(id, value.trim() !== '' && Number.isFinite(parsed) ? parsed : null);
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
