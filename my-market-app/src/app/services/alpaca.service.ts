import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AlpacaService {
  constructor(private http: HttpClient) {}

  getAccount(): Observable<any> {
    return this.http.get('/api/account');
  }

  getClock(): Observable<any> {
    return this.http.get('/api/clock');
  }

  getMarketSummary(): Observable<any[]> {
    return this.http.get<any[]>('/api/market-summary');
  }

  getBars(symbol: string, timeframe = '5Min', start?: string, end?: string): Observable<any[]> {
    const params: any = { timeframe };
    if (start) params.start = start;
    if (end) params.end = end;
    return this.http.get<any[]>(`/api/bars/${symbol}`, { params });
  }

  getSnapshots(symbols: string[]): Observable<any> {
    return this.http.get('/api/snapshots', {
      params: { symbols: symbols.join(',') }
    });
  }
}
