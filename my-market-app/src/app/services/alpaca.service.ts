import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AlpacaService {
  private readonly baseUrl = 'https://paper-api.alpaca.markets/v2';
  private readonly dataUrl = 'https://data.alpaca.markets/v2';

  constructor(private http: HttpClient) {}

  getAccount(): Observable<HttpResponse<any>> {
    return this.http.get<any>(`${this.baseUrl}/account`, { observe: 'response' });
  }

  getClock(): Observable<HttpResponse<any>> {
    return this.http.get<any>(`${this.baseUrl}/clock`, { observe: 'response' });
  }

  getMarketSummary(): Observable<HttpResponse<any>> {
    const symbols = ['DIA', 'SPY', 'QQQ'];
    return this.http.get<any>(`${this.dataUrl}/stocks/snapshots`, {
      observe: 'response',
      params: { symbols: symbols.join(','), feed: 'iex' }
    });
  }

  getBars(symbol: string, timeframe = '5Min', start?: string, end?: string): Observable<HttpResponse<any>> {
    const params: any = { timeframe, feed: 'iex' };
    if (start) params.start = start;
    if (end) params.end = end;
    params.limit = 1000;
    return this.http.get<any>(`${this.dataUrl}/stocks/${symbol}/bars`, { observe: 'response', params });
  }

  getSnapshots(symbols: string[]): Observable<HttpResponse<any>> {
    return this.http.get<any>(`${this.dataUrl}/stocks/snapshots`, {
      observe: 'response',
      params: { symbols: symbols.join(','), feed: 'iex' }
    });
  }
}
