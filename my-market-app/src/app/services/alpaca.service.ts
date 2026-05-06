import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class AlpacaService {
  private readonly baseUrl = 'https://paper-api.alpaca.markets/v2';
  private readonly dataUrl = 'https://data.alpaca.markets/v2';

  constructor(private http: HttpClient) {}

  getAccount(): Observable<any> {
    return this.http.get(`${this.baseUrl}/account`);
  }

  getClock(): Observable<any> {
    return this.http.get(`${this.baseUrl}/clock`);
  }

  getMarketSummary(): Observable<any[]> {
    const symbols = ['DIA', 'SPY', 'QQQ'];
    return this.http.get<any>(`${this.dataUrl}/stocks/snapshots`, {
      params: { symbols: symbols.join(','), feed: 'iex' }
    }).pipe(
      map(snapshots => {
        return symbols.map(symbol => {
          const snap = snapshots[symbol];
          if (!snap) return { symbol, currentPrice: null, prevClose: null, change: null, changePercent: null };
          const currentPrice = snap.latestTrade?.p ?? snap.minuteBar?.c ?? null;
          const prevClose = snap.prevDailyBar?.c ?? null;
          const change = currentPrice && prevClose ? +(currentPrice - prevClose).toFixed(2) : null;
          const changePercent = currentPrice && prevClose ? +((change! / prevClose) * 100).toFixed(2) : null;
          return { symbol, currentPrice, prevClose, change, changePercent };
        });
      })
    );
  }

  getBars(symbol: string, timeframe = '5Min', start?: string, end?: string): Observable<any[]> {
    const params: any = { timeframe, feed: 'iex' };
    if (start) params.start = start;
    if (end) params.end = end;
    params.limit = 1000;
    return this.http.get<any>(`${this.dataUrl}/stocks/${symbol}/bars`, { params }).pipe(
      map(response => {
        return (response.bars || []).map((bar: any) => ({
          time: bar.t,
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v
        }));
      })
    );
  }

  getSnapshots(symbols: string[]): Observable<any> {
    return this.http.get(`${this.dataUrl}/stocks/snapshots`, {
      params: { symbols: symbols.join(','), feed: 'iex' }
    });
  }
}
