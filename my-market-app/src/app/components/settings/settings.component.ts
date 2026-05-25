import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlpacaService } from '../../services/alpaca.service';
import { fetchFnWithState } from '../../utils/fetch-rx';
import { AlpacaAccount, AlpacaErrorBody } from '../../models/alpaca.models';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="settings">
      <h2>Alpaca Account Settings</h2>
      @if (fetchState().prefetchOrBusy) {
        <p class="loading">Loading account information...</p>
      } @else if (account(); as account) {
        <div class="settings-grid">
          <div class="settings-column">
            <div class="setting-item">
              <span class="label">Account Number</span>
              <span class="value">{{ account.account_number }}</span>
            </div>
            <div class="setting-item">
              <span class="label">Equity</span>
              <span class="value">\${{ account.equity | number:'1.2-2' }}</span>
            </div>
            <div class="setting-item">
              <span class="label">Buying Power</span>
              <span class="value">\${{ account.buying_power | number:'1.2-2' }}</span>
            </div>
            <div class="setting-item">
              <span class="label">Cash</span>
              <span class="value">\${{ account.cash | number:'1.2-2' }}</span>
            </div>
            <div class="setting-item">
              <span class="label">Portfolio Value</span>
              <span class="value">\${{ account.portfolio_value | number:'1.2-2' }}</span>
            </div>
          </div>
          <div class="settings-column">
            <div class="setting-item">
              <span class="label">Account Status</span>
              <span class="value" [class.active]="account.status === 'ACTIVE'">{{ account.status }}</span>
            </div>
            <div class="setting-item">
              <span class="label">Day Trade Count</span>
              <span class="value">{{ account.daytrade_count }}</span>
            </div>
            <div class="setting-item">
              <span class="label">Pattern Day Trader</span>
              <span class="value">{{ account.pattern_day_trader ? 'Yes' : 'No' }}</span>
            </div>
            <div class="setting-item">
              <span class="label">Trading Blocked</span>
              <span class="value">{{ account.trading_blocked ? 'Yes' : 'No' }}</span>
            </div>
            <div class="setting-item">
              <span class="label">Account Type</span>
              <span class="value">Paper Trading</span>
            </div>
          </div>
        </div>
      } @else if (fetchState().errorResOrException) {
        <p class="loading">Failed to load account information. <button class="retry-btn" (click)="fetchAccount()">Retry</button></p>
      }

      <h2 class="section-title">Market Holidays ({{ holidayYear() }})</h2>
      @if (holidaysLoading()) {
        <p class="loading">Loading market holidays...</p>
      } @else if (holidays().length) {
        <div class="holidays-grid">
          @for (holiday of holidays(); track holiday.date) {
            <div class="holiday-item" [class.past]="holiday.past">
              <span class="holiday-date">{{ holiday.displayDate }}</span>
              <span class="holiday-name">{{ holiday.name }}</span>
              <span class="holiday-day">{{ holiday.dayOfWeek }}</span>
            </div>
          }
        </div>
      } @else {
        <p class="loading">No holidays found.</p>
      }
    </div>
  `,
  styles: [`
    .settings {
      padding: 24px;
    }
    h2 {
      color: #e0e0e0;
      margin: 0 0 24px;
      font-size: 22px;
    }
    .settings-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .settings-column {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .setting-item {
      background: #16213e;
      border: 1px solid #2a3a5e;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .label {
      color: #8892b0;
      font-size: 14px;
    }
    .value {
      color: #e0e0e0;
      font-size: 15px;
      font-weight: 500;
    }
    .value.active {
      color: #28a745;
    }
    .loading {
      color: #8892b0;
    }
    .section-title {
      color: #e0e0e0;
      margin: 32px 0 20px;
      font-size: 22px;
    }
    .holidays-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }
    .holiday-item {
      background: #16213e;
      border: 1px solid #2a3a5e;
      border-radius: 8px;
      padding: 14px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .holiday-item.past {
      opacity: 0.5;
    }
    .holiday-date {
      color: #4a9eff;
      font-size: 13px;
      font-weight: 600;
      min-width: 90px;
    }
    .holiday-name {
      color: #e0e0e0;
      font-size: 14px;
      flex: 1;
      text-align: center;
    }
    .holiday-day {
      color: #8892b0;
      font-size: 13px;
      min-width: 80px;
      text-align: right;
    }
  `]
})
export class SettingsComponent implements OnInit {
  private alpacaService = inject(AlpacaService);

  fetchAccount = fetchFnWithState<AlpacaAccount, AlpacaErrorBody>(() => this.alpacaService.getAccount());

  fetchState = computed(() => {
    const { prefetchOrBusy, okRes, errorRes, errorResOrException } = this.fetchAccount.state();
    return { prefetchOrBusy, okRes, errorRes, errorResOrException };
  });

  account = computed<AlpacaAccount | null>(() => this.fetchState().okRes?.body ?? null);

  holidays = signal<{ date: string; displayDate: string; name: string; dayOfWeek: string; past: boolean }[]>([]);
  holidaysLoading = signal(false);
  holidayYear = signal(new Date().getFullYear());

  private static readonly KNOWN_HOLIDAYS: Record<string, string> = {
    '01-01': "New Year's Day",
    '01-20': 'Martin Luther King Jr. Day',
    '02-17': "Presidents' Day",
    '04-18': 'Good Friday',
    '05-26': 'Memorial Day',
    '06-19': 'Juneteenth',
    '07-04': 'Independence Day',
    '09-01': 'Labor Day',
    '11-27': 'Thanksgiving Day',
    '12-25': 'Christmas Day',
  };

  ngOnInit(): void {
    this.fetchAccount();
    this.loadHolidays();
  }

  private async loadHolidays(): Promise<void> {
    this.holidaysLoading.set(true);
    const year = this.holidayYear();
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    try {
      const res = await firstValueFrom(this.alpacaService.getCalendar(start, end));
      const tradingDays = new Set((res.body ?? []).map(d => d.date));
      const today = new Date().toISOString().split('T')[0];

      const holidayList: { date: string; displayDate: string; name: string; dayOfWeek: string; past: boolean }[] = [];
      const d = new Date(`${year}-01-01T12:00:00`);
      while (d.getFullYear() === year) {
        const day = d.getDay();
        if (day >= 1 && day <= 5) {
          const dateStr = d.toISOString().split('T')[0];
          if (!tradingDays.has(dateStr)) {
            const mmdd = dateStr.slice(5);
            const name = this.matchHolidayName(mmdd, year) || 'Market Holiday';
            holidayList.push({
              date: dateStr,
              displayDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              name,
              dayOfWeek: d.toLocaleDateString('en-US', { weekday: 'long' }),
              past: dateStr < today,
            });
          }
        }
        d.setDate(d.getDate() + 1);
      }
      this.holidays.set(holidayList);
    } catch {
      this.holidays.set([]);
    } finally {
      this.holidaysLoading.set(false);
    }
  }

  private matchHolidayName(mmdd: string, year: number): string | null {
    for (const [pattern, name] of Object.entries(SettingsComponent.KNOWN_HOLIDAYS)) {
      const pMonth = parseInt(pattern.split('-')[0]);
      const pDay = parseInt(pattern.split('-')[1]);
      const iMonth = parseInt(mmdd.split('-')[0]);
      const iDay = parseInt(mmdd.split('-')[1]);
      if (pMonth === iMonth && Math.abs(pDay - iDay) <= 3) {
        return name;
      }
    }
    return null;
  }
}
