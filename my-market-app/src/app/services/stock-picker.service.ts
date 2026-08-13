import { Injectable, inject } from '@angular/core';
import { firstValueFrom, from } from 'rxjs';
import { mergeMap, toArray } from 'rxjs/operators';
import { AlpacaService } from './alpaca.service';
import { FinnhubService } from './finnhub.service';
import { WatchlistService } from './watchlist.service';
import { AlpacaBar } from '../models/alpaca.models';
import { FinnhubMetrics, FinnhubEarningsSurprise } from '../models/finnhub.models';
import { SECTOR_SYMBOLS } from '../data/sector-symbols';

/** Per-criterion pass/partial flags contributing to a pick's score. */
export interface PickCriteria {
  belowMa200: boolean;
  greenCandles: boolean;      // last 2 daily candles both green
  volumeSurge: boolean;       // latest volume > 1.5x its trailing 20-day average
  profitable: boolean;        // positive net margin or ROE
  lowDebt: boolean;           // debt/equity < 1.0
  growingEps: boolean;        // 5-year EPS growth > 0
  fourGreenSurprises: boolean;// all of the last 4 quarters beat estimates
  epsTrendingUp: boolean;     // last-4-quarter EPS actuals rising
  revenueGrowth: boolean;     // positive YoY revenue growth
  currentRatioOk: boolean;    // current ratio > 1
  strongRoe: boolean;         // ROE > 15%
}

export interface StockPick {
  symbol: string;
  sector: string;
  price: number;
  ma200: number;
  pctToMa200: number;         // (price - ma200) / ma200 * 100 (negative = below)
  score: number;
  criteria: PickCriteria;
  metrics: FinnhubMetrics | null;
  surprises: FinnhubEarningsSurprise[] | null;
}

interface TechnicalCandidate {
  symbol: string;
  sector: string;
  price: number;
  ma200: number;
  belowMa200: boolean;
  greenCandles: boolean;
  volumeSurge: boolean;
  technicalScore: number;
}

/** How many technical survivors get the (per-symbol) Finnhub fundamental pass. Keeps us inside free limits. */
const STAGE2_CAP = 10;
/** Trading-day history needed for a 200-day SMA plus a small buffer. */
const HISTORY_DAYS = 400;
const VOLUME_SURGE_MULTIPLE = 1.5;
/** Tickers on this list are already owned and are never recommended. */
const HOLDINGS_LIST = 'Current Holdings';

@Injectable({ providedIn: 'root' })
export class StockPickerService {
  private alpaca = inject(AlpacaService);
  private finnhub = inject(FinnhubService);
  private watchlists = inject(WatchlistService);

  /**
   * Two-stage quality screen over the built-in sector universe:
   *  1. Batched Alpaca daily bars → technical filter (below 200MA, green candles, volume surge).
   *  2. Finnhub fundamentals on the top {@link STAGE2_CAP} survivors → weighted score.
   * Returns the top `count` picks, best first. Zero FMP calls.
   */
  async findPicks(count = 4, onProgress?: (message: string) => void): Promise<StockPick[]> {
    const held = new Set(this.watchlists.getSymbols(HOLDINGS_LIST));
    const universe = [...new Set(Object.values(SECTOR_SYMBOLS).flat())]
      .filter(sym => !held.has(sym.toUpperCase()));
    const sectorOf = this.#buildSectorLookup();

    if (!universe.length) return [];

    onProgress?.(`Scanning ${universe.length} symbols…`);
    const barsBySymbol = await this.#fetchDailyBars(universe);

    const candidates = this.#technicalCandidates(universe, barsBySymbol, sectorOf);
    const survivors = candidates
      .sort((a, b) => b.technicalScore - a.technicalScore || a.pctBelow() - b.pctBelow())
      .slice(0, STAGE2_CAP);

    if (!survivors.length) return [];

    onProgress?.(`Analyzing ${survivors.length} candidates…`);
    const picks = await this.#enrich(survivors);

    onProgress?.('Ranking picks…');
    return picks.sort((a, b) => b.score - a.score).slice(0, count);
  }

  #buildSectorLookup(): Map<string, string> {
    const map = new Map<string, string>();
    for (const [sector, symbols] of Object.entries(SECTOR_SYMBOLS)) {
      for (const sym of symbols) map.set(sym, sector);
    }
    return map;
  }

  /** Chunked + paginated multi-bar fetch (mirrors the Money Flow pattern). */
  async #fetchDailyBars(symbols: string[]): Promise<Record<string, AlpacaBar[]>> {
    const start = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().split('T')[0];
    const merged: Record<string, AlpacaBar[]> = {};
    for (let i = 0; i < symbols.length; i += 100) {
      const chunk = symbols.slice(i, i + 100);
      let pageToken: string | undefined;
      do {
        const res = await firstValueFrom(this.alpaca.getMultiBars(chunk, '1Day', start, pageToken));
        const body = res?.body;
        for (const [sym, arr] of Object.entries(body?.bars ?? {})) {
          (merged[sym] ??= []).push(...arr);
        }
        pageToken = body?.next_page_token ?? undefined;
      } while (pageToken);
    }
    return merged;
  }

  #technicalCandidates(
    universe: string[],
    barsBySymbol: Record<string, AlpacaBar[]>,
    sectorOf: Map<string, string>,
  ): (TechnicalCandidate & { pctBelow: () => number })[] {
    const out: (TechnicalCandidate & { pctBelow: () => number })[] = [];
    for (const symbol of universe) {
      const bars = (barsBySymbol[symbol] ?? []).slice().sort((a, b) => a.t.localeCompare(b.t));
      if (bars.length < 200) continue;

      const closes = bars.map(b => b.c);
      const ma200 = closes.slice(-200).reduce((s, c) => s + c, 0) / 200;
      const last = bars[bars.length - 1];
      const price = last.c;
      const belowMa200 = price < ma200;
      const lastGreen = last.c > last.o;

      // Hard requirements (user): must be BELOW the 200-day MA and the last candle must close green.
      if (!belowMa200 || !lastGreen) continue;

      const prev2 = bars.slice(-2);
      const greenCandles = prev2.length === 2 && prev2.every(b => b.c > b.o);

      let volumeSurge = false;
      if (bars.length >= 21) {
        const prior20 = bars.slice(-21, -1);
        const avgVol = prior20.reduce((s, b) => s + b.v, 0) / prior20.length;
        volumeSurge = avgVol > 0 && last.v > avgVol * VOLUME_SURGE_MULTIPLE;
      }

      const technicalScore = 2 + (greenCandles ? 1 : 0) + (volumeSurge ? 1 : 0);
      out.push({
        symbol,
        sector: sectorOf.get(symbol) ?? '—',
        price,
        ma200,
        belowMa200,
        greenCandles,
        volumeSurge,
        technicalScore,
        pctBelow: () => (price - ma200) / ma200 * 100,
      });
    }
    return out;
  }

  /** Fundamental enrichment on survivors (Finnhub, concurrency-limited, 12h-cached in the service). */
  async #enrich(survivors: (TechnicalCandidate & { pctBelow: () => number })[]): Promise<StockPick[]> {
    return firstValueFrom(
      from(survivors).pipe(
        mergeMap(async (c) => {
          const [metrics, surprises] = await Promise.all([
            firstValueFrom(this.finnhub.getBasicFinancials(c.symbol)),
            firstValueFrom(this.finnhub.getEarningsSurprises(c.symbol, 4)),
          ]);
          return this.#scorePick(c, metrics, surprises);
        }, 3),
        toArray(),
      ),
    );
  }

  #scorePick(
    c: TechnicalCandidate & { pctBelow: () => number },
    metrics: FinnhubMetrics | null,
    surprises: FinnhubEarningsSurprise[] | null,
  ): StockPick {
    const m = metrics;
    const profitable = !!m && ((m.netMarginTTM ?? 0) > 0 || (m.roeTTM ?? 0) > 0);
    const debtToEquity = m?.debtToEquity ?? null;
    const lowDebt = debtToEquity !== null && debtToEquity < 1.0;
    const veryLowDebt = debtToEquity !== null && debtToEquity < 0.5;
    const growingEps = (m?.epsGrowth5Y ?? 0) > 0;
    const revenueGrowth = (m?.revenueGrowthYoY ?? 0) > 0;
    const currentRatioOk = (m?.currentRatio ?? 0) > 1;
    const strongRoe = (m?.roeTTM ?? 0) > 15;

    const surp = surprises ?? [];
    const greenSurprises = surp.filter(s => (s.surprisePercent ?? 0) > 0).length;
    const fourGreenSurprises = surp.length >= 4 && greenSurprises >= 4;
    const epsTrendingUp = surp.length >= 2 && this.#trendingUp(surp.map(s => s.actual));

    const criteria: PickCriteria = {
      belowMa200: c.belowMa200,
      greenCandles: c.greenCandles,
      volumeSurge: c.volumeSurge,
      profitable,
      lowDebt,
      growingEps,
      fourGreenSurprises,
      epsTrendingUp,
      revenueGrowth,
      currentRatioOk,
      strongRoe,
    };

    // Weighted score (no tuning yet — sensible defaults for the trial run).
    let score = 0;
    score += c.belowMa200 ? 2 : 0;
    score += c.greenCandles ? 1 : 0;
    score += c.volumeSurge ? 1 : 0;
    score += profitable ? 2 : 0;
    score += veryLowDebt ? 2 : lowDebt ? 1 : 0;
    score += growingEps ? 2 : 0;
    score += fourGreenSurprises ? 2 : greenSurprises === 3 ? 1 : 0;
    score += epsTrendingUp ? 1 : 0;
    score += revenueGrowth ? 1 : 0;
    score += currentRatioOk ? 1 : 0;
    score += strongRoe ? 1 : 0;

    return {
      symbol: c.symbol,
      sector: c.sector,
      price: c.price,
      ma200: c.ma200,
      pctToMa200: +c.pctBelow().toFixed(2),
      score,
      criteria,
      metrics,
      surprises,
    };
  }

  /** True when the (non-null) values are strictly non-decreasing with a net rise. */
  #trendingUp(values: (number | null)[]): boolean {
    const nums = values.filter((v): v is number => typeof v === 'number');
    if (nums.length < 2) return false;
    for (let i = 1; i < nums.length; i += 1) {
      if (nums[i] < nums[i - 1]) return false;
    }
    return nums[nums.length - 1] > nums[0];
  }
}
