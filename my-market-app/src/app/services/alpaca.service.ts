import { Injectable } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AlpacaAccount,
  AlpacaBarsResponse,
  AlpacaClock,
  AlpacaSnapshotsResponse,
  AlpacaWatchlist,
} from '../models/alpaca.models';

@Injectable({ providedIn: 'root' })
export class AlpacaService {
  readonly #baseUrl = 'https://paper-api.alpaca.markets/v2';
  readonly #dataUrl = 'https://data.alpaca.markets/v2';

  constructor(private http: HttpClient) {}

  getAccount(): Observable<HttpResponse<AlpacaAccount>> {
    return this.http.get<AlpacaAccount>(`${this.#baseUrl}/account`, { observe: 'response' });
  }

  getClock(): Observable<HttpResponse<AlpacaClock>> {
    return this.http.get<AlpacaClock>(`${this.#baseUrl}/clock`, { observe: 'response' });
  }

  getMarketSummary(): Observable<HttpResponse<AlpacaSnapshotsResponse>> {
    const symbols = ['DIA', 'SPY', 'QQQ'];
    return this.http.get<AlpacaSnapshotsResponse>(`${this.#dataUrl}/stocks/snapshots`, {
      observe: 'response',
      params: { symbols: symbols.join(','), feed: 'iex' }
    });
  }

  getBars(symbol: string, timeframe = '5Min', start?: string, end?: string): Observable<HttpResponse<AlpacaBarsResponse>> {
    const params: Record<string, string> = { timeframe, feed: 'iex', limit: '1000' };
    if (start) params['start'] = start;
    if (end) params['end'] = end;
    return this.http.get<AlpacaBarsResponse>(`${this.#dataUrl}/stocks/${symbol}/bars`, { observe: 'response', params });
  }

  getSnapshots(symbols: string[]): Observable<HttpResponse<AlpacaSnapshotsResponse>> {
    return this.http.get<AlpacaSnapshotsResponse>(`${this.#dataUrl}/stocks/snapshots`, {
      observe: 'response',
      params: { symbols: symbols.join(','), feed: 'iex' }
    });
  }

  getWatchlists(): Observable<HttpResponse<AlpacaWatchlist[]>> {
    return this.http.get<AlpacaWatchlist[]>(`${this.#baseUrl}/watchlists`, { observe: 'response' });
  }

  getWatchlist(id: string): Observable<HttpResponse<AlpacaWatchlist>> {
    return this.http.get<AlpacaWatchlist>(`${this.#baseUrl}/watchlists/${id}`, { observe: 'response' });
  }

  createWatchlist(name: string, symbols: string[]): Observable<HttpResponse<AlpacaWatchlist>> {
    return this.http.post<AlpacaWatchlist>(`${this.#baseUrl}/watchlists`, { name, symbols }, { observe: 'response' });
  }

  addToWatchlist(watchlistId: string, symbol: string): Observable<HttpResponse<AlpacaWatchlist>> {
    return this.http.post<AlpacaWatchlist>(`${this.#baseUrl}/watchlists/${watchlistId}`, { symbol }, { observe: 'response' });
  }

  removeFromWatchlist(watchlistId: string, symbol: string): Observable<HttpResponse<AlpacaWatchlist>> {
    return this.http.delete<AlpacaWatchlist>(`${this.#baseUrl}/watchlists/${watchlistId}/${symbol}`, { observe: 'response' });
  }
}
