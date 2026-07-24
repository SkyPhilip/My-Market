import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WatchlistComponent } from '../watchlist/watchlist.component';
import { StockPickerService } from '../../services/stock-picker.service';
import { WatchlistService } from '../../services/watchlist.service';
import { NotificationService } from '../../services/notification.service';

const RECOMMENDED_LIST = 'Recommended Picks';
const MANUAL_LIST = 'Watch List';
const REFRESH_STAMP_KEY = 'recommended_picks_refreshed';

@Component({
  selector: 'app-watch-lists',
  standalone: true,
  imports: [CommonModule, WatchlistComponent],
  templateUrl: './watch-lists.component.html',
  styleUrl: './watch-lists.component.scss',
})
export class WatchListsComponent {
  private picker = inject(StockPickerService);
  private watchlistService = inject(WatchlistService);
  private notificationService = inject(NotificationService);

  readonly recommendedList = RECOMMENDED_LIST;
  readonly manualList = MANUAL_LIST;

  readonly loading = signal(false);
  readonly progress = signal('');
  readonly error = signal<string | null>(null);
  readonly lastRefreshed = signal<string>(localStorage.getItem(REFRESH_STAMP_KEY) ?? '');

  /** Runs the on-demand quality screen and replaces the Recommended Picks list with the top 4 (best first). */
  async refresh(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.progress.set('Starting…');
    try {
      const picks = await this.picker.findPicks(4, msg => this.progress.set(msg));
      if (!picks.length) {
        this.error.set('No stocks met the criteria this run — previous picks kept.');
        this.notificationService.showInfo('Stock Picker: no stocks met the criteria this run.');
        return;
      }
      this.watchlistService.replaceEntries(RECOMMENDED_LIST, picks.map(p => p.symbol));
      const stamp = new Date().toLocaleString();
      this.lastRefreshed.set(stamp);
      localStorage.setItem(REFRESH_STAMP_KEY, stamp);
      if (picks.length < 4) {
        this.notificationService.showInfo(`Stock Picker: only ${picks.length} pick${picks.length === 1 ? '' : 's'} met the criteria (fewer than 4).`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to refresh picks.';
      this.error.set(msg);
      this.notificationService.showError(msg);
    } finally {
      this.loading.set(false);
      this.progress.set('');
    }
  }
}
