import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, of, forkJoin } from 'rxjs';
import { map, tap, mergeMap, toArray, catchError } from 'rxjs/operators';
import { FmpAnalystEstimate, FmpPeer, FmpProfile, FmpRatiosTtm, FmpScreenerResult, FmpSectorPerformance } from '../models/fmp.models';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FmpService {
  readonly #baseUrl = 'https://financialmodelingprep.com/stable';
  readonly #apiKey = environment.apiKeys.fmp;
  readonly #companyNameFallbacks: Record<string, string> = {
    GOOGL: 'Alphabet Inc. Class A',
    GOOG: 'Alphabet Inc. Class C',
    MSFT: 'Microsoft Corporation',
    NVDA: 'NVIDIA Corporation',
    PLTR: 'Palantir Technologies Inc.',
    TMC: 'TMC the metals company Inc.',
    MU: 'Micron Technology, Inc.',
    GLD: 'SPDR Gold Shares',
    'BRK.B': 'Berkshire Hathaway Inc. Class B',
    'BRK.A': 'Berkshire Hathaway Inc. Class A',
    SPY: 'SPDR S&P 500 ETF Trust',
    QQQ: 'Invesco QQQ Trust',
    DIA: 'SPDR Dow Jones Industrial Average ETF Trust',
  };

  #sectorCache = new Map<string, string>();
  #companyNameCache = new Map<string, string>();
  #etfOrFundCache = new Map<string, boolean>();
  #pegyCache = new Map<string, number | null>();
  #peersCache = new Map<string, string | null>();

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
          this.#companyNameCache.set(p.symbol, p.companyName || p.symbol);
          this.#etfOrFundCache.set(p.symbol, Boolean(p.isEtf || p.isFund));
        }
        this.#saveCacheToStorage();
      })
    );
  }

  getClosestPeer(symbol: string): Observable<string | null> {
    const upper = symbol.trim().toUpperCase();
    if (!upper) return of(null);
    if (this.#peersCache.has(upper)) {
      return of(this.#peersCache.get(upper) ?? null);
    }
    return this.http.get<FmpPeer[]>(`${this.#baseUrl}/stock-peers`, {
      params: { symbol: upper, apikey: this.#apiKey }
    }).pipe(
      map(peers => (peers ?? []).find(p => {
        const s = (p.symbol ?? '').toUpperCase();
        return s && s !== upper;
      }) ?? null),
      catchError(() => of<FmpPeer | null>(null)),
      map(peer => {
        const peerSymbol = peer?.symbol ? peer.symbol.toUpperCase() : null;
        if (peerSymbol && peer?.companyName) {
          this.#companyNameCache.set(peerSymbol, peer.companyName);
        }
        this.#peersCache.set(upper, peerSymbol);
        this.#saveCacheToStorage();
        return peerSymbol;
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

  getCachedCompanyName(symbol: string): string | undefined {
    const upper = symbol.toUpperCase();
    return this.#companyNameCache.get(upper) ?? this.#companyNameFallbacks[upper];
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

  getPegy(symbols: string[]): Observable<Map<string, number | null>> {
    const uniqueSymbols = [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean))];
    const uncachedSymbols = uniqueSymbols.filter(symbol => !this.#pegyCache.has(symbol));

    if (!uncachedSymbols.length) {
      return of(new Map(uniqueSymbols.map(symbol => [symbol, this.#pegyCache.get(symbol) ?? null])));
    }

    return from(uncachedSymbols).pipe(
      mergeMap(symbol => forkJoin({
        ratios: this.http.get<FmpRatiosTtm[]>(`${this.#baseUrl}/ratios-ttm`, {
          params: { symbol, apikey: this.#apiKey }
        }).pipe(
          map(arr => arr[0] ?? null),
          catchError(() => of(null))
        ),
        estimates: this.http.get<FmpAnalystEstimate[]>(`${this.#baseUrl}/analyst-estimates`, {
          params: { symbol, period: 'annual', apikey: this.#apiKey }
        }).pipe(
          map(arr => arr ?? []),
          catchError(() => of([] as FmpAnalystEstimate[]))
        ),
      }).pipe(
        map(({ ratios, estimates }) => {
          const isEtfOrFund = this.#etfOrFundCache.get(symbol) ?? false;
          const pegy = isEtfOrFund ? null : this.#computePegy(ratios, estimates);
          return { symbol, pegy };
        })
      ), 5),
      toArray(),
      map(results => {
        for (const { symbol, pegy } of results) {
          this.#pegyCache.set(symbol, pegy);
        }
        return new Map(uniqueSymbols.map(symbol => [symbol, this.#pegyCache.get(symbol) ?? null]));
      })
    );
  }

  #computePegy(ratios: FmpRatiosTtm | null, estimates: FmpAnalystEstimate[]): number | null {
    const pe = ratios?.priceToEarningsRatioTTM ?? null;
    const dividendYieldPct = ratios?.dividendYieldTTM ?? null;
    const expectedGrowthPct = this.#computeExpectedAnnualEpsGrowthPct(estimates);

    if (
      pe === null ||
      !Number.isFinite(pe) ||
      pe <= 0 ||
      dividendYieldPct === null ||
      !Number.isFinite(dividendYieldPct) ||
      expectedGrowthPct === null ||
      !Number.isFinite(expectedGrowthPct)
    ) {
      return null;
    }

    const denominator = expectedGrowthPct + (dividendYieldPct * 100);
    if (!Number.isFinite(denominator) || denominator <= 0) {
      return null;
    }

    const pegy = pe / denominator;
    return Number.isFinite(pegy) ? +pegy.toFixed(3) : null;
  }

  #computeExpectedAnnualEpsGrowthPct(estimates: FmpAnalystEstimate[]): number | null {
    if (!estimates.length) return null;

    const now = new Date();
    const currentYear = now.getUTCFullYear();

    const futureEstimates = estimates
      .map(e => {
        const year = Number((e.date || '').slice(0, 4));
        return { year, epsAvg: e.epsAvg ?? null, numAnalystsEps: e.numAnalystsEps ?? 0 };
      })
      .filter(e => Number.isFinite(e.year) && e.year > currentYear && e.epsAvg !== null && e.epsAvg > 0)
      .sort((a, b) => a.year - b.year);

    if (futureEstimates.length < 2) return null;

    const start = futureEstimates[0];
    const targetYear = start.year + 3;
    const end = futureEstimates.find(e => e.year >= targetYear) ?? futureEstimates[futureEstimates.length - 1];
    const years = end.year - start.year;

    if (years <= 0 || start.epsAvg === null || end.epsAvg === null || start.epsAvg <= 0 || end.epsAvg <= 0) {
      return null;
    }

    const growth = (Math.pow(end.epsAvg / start.epsAvg, 1 / years) - 1) * 100;
    return Number.isFinite(growth) ? growth : null;
  }

  #loadCacheFromStorage(): void {
    try {
      const sectorStored = sessionStorage.getItem('fmp_sector_cache');
      if (sectorStored) {
        const entries: [string, string][] = JSON.parse(sectorStored);
        this.#sectorCache = new Map(entries);
      }

      const nameStored = sessionStorage.getItem('fmp_name_cache');
      if (nameStored) {
        const entries: [string, string][] = JSON.parse(nameStored);
        this.#companyNameCache = new Map(entries);
      }

      const etfStored = sessionStorage.getItem('fmp_etf_cache');
      if (etfStored) {
        const entries: [string, boolean][] = JSON.parse(etfStored);
        this.#etfOrFundCache = new Map(entries);
      }

      const peersStored = sessionStorage.getItem('fmp_peers_cache');
      if (peersStored) {
        const entries: [string, string | null][] = JSON.parse(peersStored);
        this.#peersCache = new Map(entries);
      }
    } catch {
      // ignore corrupt cache
    }
  }

  #saveCacheToStorage(): void {
    sessionStorage.setItem('fmp_sector_cache', JSON.stringify([...this.#sectorCache.entries()]));
    sessionStorage.setItem('fmp_name_cache', JSON.stringify([...this.#companyNameCache.entries()]));
    sessionStorage.setItem('fmp_etf_cache', JSON.stringify([...this.#etfOrFundCache.entries()]));
    sessionStorage.setItem('fmp_peers_cache', JSON.stringify([...this.#peersCache.entries()]));
  }

  clearCache(): void {
    this.#sectorCache.clear();
    this.#companyNameCache.clear();
    this.#etfOrFundCache.clear();
    this.#pegyCache.clear();
    this.#peersCache.clear();
    sessionStorage.removeItem('fmp_sector_cache');
    sessionStorage.removeItem('fmp_name_cache');
    sessionStorage.removeItem('fmp_etf_cache');
    sessionStorage.removeItem('fmp_peers_cache');
  }
}
