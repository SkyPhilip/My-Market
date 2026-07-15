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
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
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
