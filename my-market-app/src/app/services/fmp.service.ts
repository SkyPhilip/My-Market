import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, of } from 'rxjs';
import { map, tap, mergeMap, toArray, catchError } from 'rxjs/operators';
import { FmpProfile, FmpScreenerResult, FmpSectorPerformance } from '../models/fmp.models';

@Injectable({ providedIn: 'root' })
export class FmpService {
  readonly #baseUrl = 'https://financialmodelingprep.com/stable';
  readonly #apiKey = 'sCcFQ6sVkljriewJXLu1RGznuKSaJ6pE';

  #sectorCache = new Map<string, string>();

  constructor(private http: HttpClient) {
    this.#loadCacheFromStorage();
  }

  getProfiles(symbols: string[]): Observable<FmpProfile[]> {
    return from(symbols).pipe(
      mergeMap(symbol =>
        this.http.get<FmpProfile[]>(`${this.#baseUrl}/profile`, {
          params: { symbol, apikey: this.#apiKey }
        }).pipe(
          map(arr => arr[0] ?? null),
          catchError(() => of(null))
        ),
        5 // max 5 concurrent requests
      ),
      toArray(),
      map(profiles => profiles.filter((p): p is FmpProfile => !!p)),
      tap(profiles => {
        for (const p of profiles) {
          this.#sectorCache.set(p.symbol, p.sector || '—');
        }
        this.#saveCacheToStorage();
      })
    );
  }

  getSectorPerformance(): Observable<FmpSectorPerformance[]> {
    return this.http.get<FmpSectorPerformance[]>(`${this.#baseUrl}/sector-performance-snapshot`, {
      params: { apikey: this.#apiKey }
    });
  }

  getCachedSector(symbol: string): string | undefined {
    return this.#sectorCache.get(symbol);
  }

  getAvailableSectors(): Observable<string[]> {
    return this.http.get<{ sector: string }[]>(`${this.#baseUrl}/available-sectors`, {
      params: { apikey: this.#apiKey }
    }).pipe(
      map(results => results.map(r => r.sector))
    );
  }

  getTopBySector(sector: string, limit = 30): Observable<FmpScreenerResult[]> {
    return this.http.get<FmpScreenerResult[]>(`${this.#baseUrl}/company-screener`, {
      params: { sector, limit: limit.toString(), apikey: this.#apiKey }
    });
  }

  #loadCacheFromStorage(): void {
    try {
      const stored = sessionStorage.getItem('fmp_sector_cache');
      if (stored) {
        const entries: [string, string][] = JSON.parse(stored);
        this.#sectorCache = new Map(entries);
      }
    } catch {
      // ignore corrupt cache
    }
  }

  #saveCacheToStorage(): void {
    sessionStorage.setItem('fmp_sector_cache', JSON.stringify([...this.#sectorCache.entries()]));
  }
}
