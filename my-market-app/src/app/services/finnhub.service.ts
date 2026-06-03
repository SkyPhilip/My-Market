import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, map, tap } from 'rxjs/operators';
import { FinnhubNewsArticle } from '../models/finnhub.models';
import { environment } from '../../environments/environment';

interface FinnhubNewsCacheEntry {
  loadedAt: number;
  articles: FinnhubNewsArticle[];
}

@Injectable({ providedIn: 'root' })
export class FinnhubService {
  readonly #baseUrl = 'https://finnhub.io/api/v1';
  readonly #apiKey = environment.apiKeys.finnhub;
  readonly #cacheTtlMs = 30 * 60 * 1000;

  #newsCache = new Map<string, FinnhubNewsCacheEntry>();

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