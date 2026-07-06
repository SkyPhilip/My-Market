import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, map, tap } from 'rxjs/operators';
import { FinnhubNewsArticle, FinnhubMetrics, FinnhubRecommendation, FinnhubEarningsDate, FinnhubEarningsSurprise } from '../models/finnhub.models';
import { environment } from '../../environments/environment';

interface FinnhubNewsCacheEntry {
  loadedAt: number;
  articles: FinnhubNewsArticle[];
}

interface FinnhubMetricsCacheEntry {
  loadedAt: number;
  metrics: FinnhubMetrics;
}

interface FinnhubRecoCacheEntry {
  loadedAt: number;
  data: FinnhubRecommendation[];
}

interface FinnhubEarningsCacheEntry {
  loadedAt: number;
  next: FinnhubEarningsDate | null;
}

interface FinnhubSurprisesCacheEntry {
  loadedAt: number;
  data: FinnhubEarningsSurprise[];
}

@Injectable({ providedIn: 'root' })
export class FinnhubService {
  readonly #baseUrl = 'https://finnhub.io/api/v1';
  readonly #apiKey = environment.apiKeys.finnhub;
  readonly #cacheTtlMs = 30 * 60 * 1000;

  #newsCache = new Map<string, FinnhubNewsCacheEntry>();
  #metricsCache = new Map<string, FinnhubMetricsCacheEntry>();
  #recoCache = new Map<string, FinnhubRecoCacheEntry>();
  #earningsCache = new Map<string, FinnhubEarningsCacheEntry>();
  #surprisesCache = new Map<string, FinnhubSurprisesCacheEntry>();
  readonly #metricsTtlMs = 12 * 60 * 60 * 1000;

  constructor(private http: HttpClient) {}

  getNews(symbol: string): Observable<FinnhubNewsArticle[]> {
    if (!this.#apiKey.trim()) {
      return throwError(() => new Error('Finnhub API key is not configured.'));
    }

    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!normalizedSymbol) {
      return of([]);
    }

    const cached = this.#newsCache.get(normalizedSymbol);
    if (cached && Date.now() - cached.loadedAt < this.#cacheTtlMs) {
      return of(cached.articles);
    }

    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);

    return this.http.get<FinnhubNewsArticle[] | { data?: FinnhubNewsArticle[] }>(`${this.#baseUrl}/company-news`, {
      params: {
        symbol: normalizedSymbol,
        from: this.#formatDate(from),
        to: this.#formatDate(to),
        token: this.#apiKey,
      }
    }).pipe(
      map(response => Array.isArray(response) ? response : response.data ?? []),
      map(articles => articles
        .filter(article => Boolean(article?.headline && article?.url))
        .sort((a, b) => b.datetime - a.datetime)
      ),
      tap(articles => {
        this.#newsCache.set(normalizedSymbol, {
          loadedAt: Date.now(),
          articles,
        });
      }),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse) {
          const detail = this.#extractErrorMessage(error);
          return throwError(() => new Error(`Finnhub request failed: ${detail}`));
        }
        return throwError(() => new Error('Finnhub request failed.'));
      })
    );
  }

  /** Curated basic financials (beta, 52w range, valuation, quality, growth). Cached ~12h; null on failure. */
  getBasicFinancials(symbol: string): Observable<FinnhubMetrics | null> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!this.#apiKey.trim() || !normalizedSymbol) {
      return of(null);
    }

    const cached = this.#metricsCache.get(normalizedSymbol);
    if (cached && Date.now() - cached.loadedAt < this.#metricsTtlMs) {
      return of(cached.metrics);
    }

    return this.http.get<{ metric?: Record<string, number | null> }>(`${this.#baseUrl}/stock/metric`, {
      params: { symbol: normalizedSymbol, metric: 'all', token: this.#apiKey }
    }).pipe(
      map(response => this.#mapMetrics(response?.metric ?? {})),
      tap(metrics => this.#metricsCache.set(normalizedSymbol, { loadedAt: Date.now(), metrics })),
      catchError(() => of(null))
    );
  }

  /** Analyst recommendation trends (most-recent month first). Cached ~12h; null on failure. */
  getRecommendationTrends(symbol: string): Observable<FinnhubRecommendation[] | null> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!this.#apiKey.trim() || !normalizedSymbol) {
      return of(null);
    }

    const cached = this.#recoCache.get(normalizedSymbol);
    if (cached && Date.now() - cached.loadedAt < this.#metricsTtlMs) {
      return of(cached.data);
    }

    return this.http.get<FinnhubRecommendation[]>(`${this.#baseUrl}/stock/recommendation`, {
      params: { symbol: normalizedSymbol, token: this.#apiKey }
    }).pipe(
      map(response => Array.isArray(response) ? response : []),
      tap(data => this.#recoCache.set(normalizedSymbol, { loadedAt: Date.now(), data })),
      catchError(() => of(null))
    );
  }

  /** Next scheduled earnings report (soonest date from today forward). Cached ~12h; null on failure or none. */
  getNextEarnings(symbol: string): Observable<FinnhubEarningsDate | null> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!this.#apiKey.trim() || !normalizedSymbol) {
      return of(null);
    }

    const cached = this.#earningsCache.get(normalizedSymbol);
    if (cached && Date.now() - cached.loadedAt < this.#metricsTtlMs) {
      return of(cached.next);
    }

    const from = this.#formatDate(new Date());
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 180);
    const to = this.#formatDate(toDate);

    return this.http.get<{ earningsCalendar?: Array<{ date: string; hour: string; epsEstimate: number | null }> }>(`${this.#baseUrl}/calendar/earnings`, {
      params: { symbol: normalizedSymbol, from, to, token: this.#apiKey }
    }).pipe(
      map(response => {
        const list = (response?.earningsCalendar ?? [])
          .filter(e => e.date >= from)
          .sort((a, b) => a.date.localeCompare(b.date));
        const first = list[0];
        return first ? { date: first.date, hour: first.hour ?? '', epsEstimate: this.#num(first.epsEstimate) } : null;
      }),
      tap(next => this.#earningsCache.set(normalizedSymbol, { loadedAt: Date.now(), next })),
      catchError(() => of(null))
    );
  }

  /** Recent EPS beats/misses, oldest→newest, up to `limit` quarters. Cached ~12h; null on failure. */
  getEarningsSurprises(symbol: string, limit = 4): Observable<FinnhubEarningsSurprise[] | null> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!this.#apiKey.trim() || !normalizedSymbol) {
      return of(null);
    }

    const cached = this.#surprisesCache.get(normalizedSymbol);
    if (cached && Date.now() - cached.loadedAt < this.#metricsTtlMs) {
      return of(cached.data);
    }

    return this.http.get<Array<{ period: string; actual: number | null; estimate: number | null; surprisePercent: number | null }>>(`${this.#baseUrl}/stock/earnings`, {
      params: { symbol: normalizedSymbol, token: this.#apiKey }
    }).pipe(
      map(response => (Array.isArray(response) ? response : [])
        .slice()
        .sort((a, b) => a.period.localeCompare(b.period))
        .slice(-limit)
        .map(e => ({ period: e.period, actual: this.#num(e.actual), estimate: this.#num(e.estimate), surprisePercent: this.#num(e.surprisePercent) }))
      ),
      tap(data => this.#surprisesCache.set(normalizedSymbol, { loadedAt: Date.now(), data })),
      catchError(() => of(null))
    );
  }

  #num(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  #mapMetrics(m: Record<string, number | null>): FinnhubMetrics {
    return {
      beta: this.#num(m['beta']),
      week52High: this.#num(m['52WeekHigh']),
      week52Low: this.#num(m['52WeekLow']),
      peTTM: this.#num(m['peTTM']),
      psTTM: this.#num(m['psTTM']),
      pbAnnual: this.#num(m['pbAnnual']),
      roeTTM: this.#num(m['roeTTM']),
      netMarginTTM: this.#num(m['netProfitMarginTTM']),
      currentRatio: this.#num(m['currentRatioAnnual']),
      debtToEquity: this.#num(m['totalDebt/totalEquityAnnual']),
      epsGrowth5Y: this.#num(m['epsGrowth5Y']),
      revenueGrowthYoY: this.#num(m['revenueGrowthTTMYoy']),
      dividendYield: this.#num(m['dividendYieldIndicatedAnnual']),
    };
  }

  #extractErrorMessage(error: HttpErrorResponse): string {
    const payload = error.error;
    if (payload && typeof payload === 'object' && typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
    if (typeof payload === 'string' && payload.trim()) {
      return payload.trim();
    }
    return error.message || 'Unknown error';
  }

  #formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}