import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { AlpacaService } from '../../services/alpaca.service';
import { FmpService } from '../../services/fmp.service';
import { WatchlistService } from '../../services/watchlist.service';
import { AlpacaSnapshot, AlpacaBar } from '../../models/alpaca.models';
import { SECTOR_SYMBOLS } from '../../data/sector-symbols';

interface MoverRow {
  symbol: string;
  sector: string;
  price: number;
  change: number;
  percentChange: number;
}

interface AverageBreakoutRow {
  symbol: string;
  sector: string;
  price: number;
  priceMultiple: number | null;
  volumeMultiple: number | null;
}

interface AverageBreakoutGroup {
  period: number;
  rows: AverageBreakoutRow[];
}

interface SectorHolding {
  symbol: string;
  changePct: number | null;
  volume: number;
}

interface SectorFlow {
  sector: string;
  count: number;
  avgChangePct: number;   // simple avg of constituent % change
  relStrength: number;    // sector avg change − SPY change
  breadthPct: number;     // % of constituents up
  netVolume: number;      // advancing volume − declining volume
  netVolumeRatio: number; // netVolume / total volume  (−1..1)
  volumeThrust: number;   // today volume / prior-day volume
  flowScore: number;      // composite
  totalVolume: number;    // sum of constituent daily volume
  holdings: SectorHolding[]; // constituents, sorted best→worst by % change
}

interface FlowEntry {
  symbol: string;
  change: number | null;
  vol: number;
  prevVol: number;
}

interface FlowSeries {
  sector: string;
  color: string;
  data: { time: string; value: number }[];
}

interface SectorRank {
  sector: string;
  color: string;
  score: number;
  rank: number;
  change: number | null;
}

interface RankingSession {
  date: string;
  label: string;
  rankings: SectorRank[];
  missing: string[];
}

const BENCHMARK = 'SPY';
const FLOW_HISTORY_DAYS = 92; // ~3 months
const BREAKOUT_LOOKBACK_DAYS = 320; // enough calendar days for 200 completed sessions
const MOVERS_SHOWN = 10;
const BREAKOUTS_SHOWN = 6;
const BREAKOUT_MULTIPLE = 2;
const BREAKOUT_PERIODS = [20, 50, 200];
/** First sector wins for a ticker listed under more than one. */
const SYMBOL_SECTOR: Record<string, string> = Object.fromEntries(
  Object.entries(SECTOR_SYMBOLS).flatMap(([sector, symbols]) => symbols.map(s => [s, sector] as const)),
);

const SECTOR_COLORS: Record<string, string> = {
  'Technology': '#4a9eff',
  'Healthcare': '#28a745',
  'Financial Services': '#ffc107',
  'Consumer Cyclical': '#b07cff',
  'Communication Services': '#ff7d86',
  'Industrials': '#40e0d0',
  'Consumer Defensive': '#f0934e',
  'Energy': '#9ac4ff',
  'Utilities': '#f06292',
  'Real Estate': '#8bc34a',
  'Basic Materials': '#e0e0e0',
};

@Component({
  selector: 'app-money-flow',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './money-flow.component.html',
  styleUrl: './money-flow.component.scss',
})
export class MoneyFlowComponent implements OnInit {
  private alpaca = inject(AlpacaService);
  private fmp = inject(FmpService);
  private watchlistService = inject(WatchlistService);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly flows = signal<SectorFlow[]>([]);
  readonly asOf = signal('');
  readonly flowHistory = signal<FlowSeries[]>([]);
  readonly historyWindow = signal(20);
  readonly selectedSector = signal<string | null>(null);
  readonly hoveredSector = signal<string | null>(null);
  readonly highlightedSector = computed(() => this.hoveredSector() ?? this.selectedSector());
  readonly rankRows = Array.from({ length: Object.keys(SECTOR_SYMBOLS).length }, (_, i) => i + 1);
  readonly rankingSessions = computed<RankingSession[]>(() => {
    const series = this.flowHistory();
    const dates = [...new Set(series.flatMap(s => s.data.map(point => point.time)))].sort();
    const scores = new Map(series.map(s => [s.sector, new Map(s.data.map(point => [point.time, point.value]))]));
    let previous = new Map<string, number>();
    return dates.map(date => {
      const available = series.flatMap(s => {
        const score = scores.get(s.sector)?.get(date);
        return score !== undefined && Number.isFinite(score) ? [{ sector: s.sector, color: s.color, score }] : [];
      }).sort((a, b) => b.score - a.score || a.sector.localeCompare(b.sector));
      const rankings = available.map((entry, index) => ({
        ...entry,
        rank: index + 1,
        change: previous.has(entry.sector) ? previous.get(entry.sector)! - (index + 1) : null,
      }));
      previous = new Map(rankings.map(entry => [entry.sector, entry.rank]));
      return {
        date,
        label: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        rankings,
        missing: series.filter(s => !rankings.some(entry => entry.sector === s.sector)).map(s => s.sector),
      };
    }).reverse();
  });
  readonly visibleSessions = computed(() => this.rankingSessions().slice(0, this.historyWindow()));
  readonly expandedSector = signal<string | null>(null);
  readonly moversGainers = signal<MoverRow[]>([]);
  readonly moversLosers = signal<MoverRow[]>([]);
  readonly averageBreakoutGroups = signal<AverageBreakoutGroup[]>([]);
  readonly breakoutsLoading = signal(false);
  readonly breakoutsLoaded = signal(false);
  readonly breakoutsError = signal<string | null>(null);
  readonly breakoutsAsOf = signal('');
  // Bumped after lazily fetching company names so the view re-reads the cache.
  private readonly namesVersion = signal(0);

  readonly flowScoreTooltip =
    'Flow Score = Rel. Strength + (Breadth − 50) / 50 × 2 + Net Volume Ratio × 3\n' +
    'Rel. Strength = sector avg % change − SPY % change\n' +
    'Breadth = % of constituents up\n' +
    'Net Volume Ratio = (advancing − declining volume) / total volume\n' +
    'Higher = stronger inferred rotation into the sector, not measured cash flow.';

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const allSymbols = Array.from(new Set([BENCHMARK, ...Object.values(SECTOR_SYMBOLS).flat()]));
      const snaps = await this.fetchAllSnapshots(allSymbols);
      this.buildMovers(snaps, allSymbols.filter(s => s !== BENCHMARK));
      const spyChange = this.changePct(snaps[BENCHMARK]);

      const flows: SectorFlow[] = Object.entries(SECTOR_SYMBOLS).map(([sector, symbols]) => {
        const entries = symbols.map(sym => {
          const snap = snaps[sym];
          if (!snap) return null;
          return { symbol: sym, change: this.changePct(snap), vol: snap.dailyBar?.v ?? 0, prevVol: snap.prevDailyBar?.v ?? 0 };
        }).filter((e): e is FlowEntry => e !== null);
        const holdings: SectorHolding[] = entries
          .map(e => ({ symbol: e.symbol, changePct: e.change, volume: e.vol }))
          .sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
        return { ...this.aggregateFlow(sector, entries, spyChange), holdings };
      });

      flows.sort((a, b) => b.flowScore - a.flowScore);
      this.flows.set(flows);
      this.asOf.set(new Date().toLocaleString());

      // Reconstruct completed-session scores from daily bars, not cached live snapshots.
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - FLOW_HISTORY_DAYS - 10);
      const dailyBars = await this.fetchMultiBars(allSymbols, startDate.toISOString().split('T')[0]);
      const historyStart = new Date();
      historyStart.setDate(historyStart.getDate() - FLOW_HISTORY_DAYS);
      this.flowHistory.set(this.buildFlowHistory(dailyBars, historyStart.toISOString().split('T')[0]));

      this.loaded.set(true);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load market data.');
    } finally {
      this.loading.set(false);
    }
  }

  async loadBreakouts(): Promise<void> {
    if (this.breakoutsLoading()) return;
    this.breakoutsLoading.set(true);
    this.breakoutsLoaded.set(false);
    this.breakoutsError.set(null);
    this.averageBreakoutGroups.set([]);
    try {
      const symbols = Array.from(new Set(Object.values(SECTOR_SYMBOLS).flat()));
      const snaps = await this.fetchAllSnapshots(symbols);
      if (!symbols.some(symbol => {
        const snap = snaps[symbol];
        const price = snap?.latestTrade?.p ?? snap?.minuteBar?.c ?? snap?.dailyBar?.c;
        return price !== undefined && Number.isFinite(price) && price > 0;
      })) {
        throw new Error('No current price data available for breakout analysis.');
      }
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - BREAKOUT_LOOKBACK_DAYS);
      const dailyBars = await this.fetchMultiBars(symbols, startDate.toISOString().split('T')[0]);
      if (!symbols.some(symbol => (dailyBars[symbol]?.length ?? 0) > 0)) {
        throw new Error('No historical daily bars available for breakout analysis.');
      }
      this.buildAverageBreakouts(snaps, dailyBars, symbols);
      this.breakoutsAsOf.set(new Date().toLocaleString());
      this.breakoutsLoaded.set(true);
    } catch (e) {
      this.breakoutsError.set(e instanceof Error ? e.message : 'Failed to analyze breakouts.');
    } finally {
      this.breakoutsLoading.set(false);
    }
  }

  /** Best/worst performers inside the tracked sector universe; reuses the snapshots already fetched. */
  private buildMovers(snaps: Record<string, AlpacaSnapshot>, symbols: string[]): void {
    const rows = symbols
      .map(symbol => {
        const snap = snaps[symbol];
        const percentChange = this.changePct(snap);
        const price = snap?.latestTrade?.p ?? snap?.minuteBar?.c ?? snap?.dailyBar?.c ?? null;
        const prev = snap?.prevDailyBar?.c ?? null;
        if (percentChange === null || price === null || prev === null) return null;
        return { symbol, sector: SYMBOL_SECTOR[symbol] ?? '', price, change: price - prev, percentChange };
      })
      .filter((row): row is MoverRow => row !== null)
      .sort((a, b) => b.percentChange - a.percentChange);

    this.moversGainers.set(rows.filter(r => r.percentChange > 0).slice(0, MOVERS_SHOWN));
    this.moversLosers.set(rows.filter(r => r.percentChange < 0).slice(-MOVERS_SHOWN).reverse());
    this.loadMoverNames();
  }

  /** Live price and today's volume relative to completed daily-session averages. */
  private buildAverageBreakouts(snaps: Record<string, AlpacaSnapshot>, dailyBars: Record<string, AlpacaBar[]>, symbols: string[]): void {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const groups = BREAKOUT_PERIODS.map(period => ({
      period,
      rows: symbols.map(symbol => {
        const snap = snaps[symbol];
        const price = snap?.latestTrade?.p ?? snap?.minuteBar?.c ?? snap?.dailyBar?.c ?? null;
        const volume = snap?.dailyBar?.v ?? null;
        const priorBars = (dailyBars[symbol] ?? [])
          .filter(bar => bar.t.split('T')[0] < today)
          .sort((a, b) => a.t.localeCompare(b.t))
          .slice(-period);
        if (price === null || priorBars.length < period) return null;

        const priceAverage = priorBars.reduce((sum, bar) => sum + bar.c, 0) / priorBars.length;
        const volumeAverage = priorBars.reduce((sum, bar) => sum + bar.v, 0) / priorBars.length;
        const priceMultiple = priceAverage > 0 ? price / priceAverage : null;
        const volumeMultiple = volume !== null && volumeAverage > 0 ? volume / volumeAverage : null;
        if ((priceMultiple ?? 0) <= BREAKOUT_MULTIPLE && (volumeMultiple ?? 0) <= BREAKOUT_MULTIPLE) return null;
        return { symbol, sector: SYMBOL_SECTOR[symbol] ?? '', price, priceMultiple, volumeMultiple };
      })
        .filter((row): row is AverageBreakoutRow => row !== null)
        .sort((first, second) => Math.max(second.priceMultiple ?? 0, second.volumeMultiple ?? 0) - Math.max(first.priceMultiple ?? 0, first.volumeMultiple ?? 0))
        .slice(0, BREAKOUTS_SHOWN),
    }));

    this.averageBreakoutGroups.set(groups);
    this.loadBreakoutNames();
  }

  /** Company names for the movers panel; non-fatal and usually a cache hit. */
  private async loadMoverNames(): Promise<void> {
    const symbols = [...this.moversGainers(), ...this.moversLosers()].map(m => m.symbol);
    const uncached = symbols.filter(s => !this.fmp.getCachedCompanyName(s));
    if (!uncached.length) return;
    try {
      await firstValueFrom(this.fmp.getProfiles(uncached));
      this.namesVersion.update(v => v + 1);
    } catch {
      // Names are non-critical; symbols remain as the fallback display.
    }
  }

  /** Company names for the breakout panel; non-fatal and usually a cache hit. */
  private async loadBreakoutNames(): Promise<void> {
    const symbols = this.averageBreakoutGroups().flatMap(group => group.rows.map(row => row.symbol));
    const uncached = symbols.filter(symbol => !this.fmp.getCachedCompanyName(symbol));
    if (!uncached.length) return;
    try {
      await firstValueFrom(this.fmp.getProfiles(uncached));
      this.namesVersion.update(version => version + 1);
    } catch {
      // Names are non-critical; symbols remain as the fallback display.
    }
  }

  private aggregateFlow(sector: string, entries: FlowEntry[], spyChange: number | null): Omit<SectorFlow, 'holdings'> {
    let changeSum = 0, changeCount = 0, upCount = 0, total = 0;
    let upVol = 0, downVol = 0, dayVol = 0, prevVol = 0;
    for (const e of entries) {
      total++;
      dayVol += e.vol;
      prevVol += e.prevVol;
      if (e.change === null) continue;
      changeSum += e.change; changeCount++;
      if (e.change >= 0) { upCount++; upVol += e.vol; } else { downVol += e.vol; }
    }
    const avgChangePct = changeCount ? changeSum / changeCount : 0;
    const relStrength = +(avgChangePct - (spyChange ?? 0)).toFixed(2);
    const breadthPct = total ? Math.round((upCount / total) * 100) : 0;
    const netVolume = upVol - downVol;
    const netVolumeRatio = dayVol ? +(netVolume / dayVol).toFixed(3) : 0;
    const volumeThrust = prevVol ? +(dayVol / prevVol).toFixed(2) : 0;
    // Composite (documented weights): rel. strength + breadth tilt + net-volume direction
    const flowScore = +(relStrength + ((breadthPct - 50) / 50) * 2 + netVolumeRatio * 3).toFixed(2);
    return { sector, count: total, avgChangePct: +avgChangePct.toFixed(2), relStrength, breadthPct, netVolume, netVolumeRatio, volumeThrust, flowScore, totalVolume: dayVol };
  }

  private changePct(snap: AlpacaSnapshot | undefined): number | null {
    if (!snap) return null;
    const price = snap.latestTrade?.p ?? snap.minuteBar?.c ?? snap.dailyBar?.c ?? null;
    const prev = snap.prevDailyBar?.c ?? null;
    if (price === null || prev === null || prev === 0) return null;
    return ((price - prev) / prev) * 100;
  }

  private async fetchAllSnapshots(symbols: string[]): Promise<Record<string, AlpacaSnapshot>> {
    const merged: Record<string, AlpacaSnapshot> = {};
    for (let i = 0; i < symbols.length; i += 100) {
      const res = await firstValueFrom(this.alpaca.getSnapshots(symbols.slice(i, i + 100)));
      Object.assign(merged, res?.body ?? {});
    }
    return merged;
  }

  scoreColor(score: number): string {
    const clamped = Math.max(-6, Math.min(6, score));
    const alpha = (0.15 + (Math.abs(clamped) / 6) * 0.5).toFixed(2);
    return clamped >= 0 ? `rgba(40, 167, 69, ${alpha})` : `rgba(220, 53, 69, ${alpha})`;
  }

  formatVolume(v: number): string {
    const sign = v < 0 ? '-' : '';
    const a = Math.abs(v);
    if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
    return `${sign}${a}`;
  }

  selectSector(sector: string): void {
    this.selectedSector.update(selected => selected === sector ? null : sector);
  }

  rankingTooltip(session: RankingSession, entry: SectorRank): string {
    const change = entry.change === null ? 'Unavailable' : entry.change > 0 ? `Up ${entry.change}` : entry.change < 0 ? `Down ${-entry.change}` : 'Unchanged';
    return `${entry.sector} · ${session.date}\nRank: ${entry.rank} of ${session.rankings.length}\nFlow Score: ${entry.score.toFixed(2)}\nRank change vs previous session: ${change}`;
  }

  toggleRow(sector: string): void {
    // Accordion: only one sector open at a time.
    const next = this.expandedSector() === sector ? null : sector;
    this.expandedSector.set(next);
    if (next) this.ensureCompanyNames(next);
  }

  holdingName(symbol: string): string {
    this.namesVersion(); // establish dependency so the view refreshes after a fetch
    return this.fmp.getCachedCompanyName(symbol) ?? symbol;
  }

  addToWatchList(symbol: string): void {
    this.watchlistService.addSymbol('Watch List', symbol);
  }

  inWatchList(symbol: string): boolean {
    this.watchlistService.version('Watch List')(); // reactive dependency
    return this.watchlistService.has('Watch List', symbol);
  }

  private async ensureCompanyNames(sector: string): Promise<void> {
    const symbols = this.flows().find(f => f.sector === sector)?.holdings.map(h => h.symbol) ?? [];
    const uncached = symbols.filter(s => !this.fmp.getCachedCompanyName(s));
    if (!uncached.length) return;
    try {
      await firstValueFrom(this.fmp.getProfiles(uncached));
      this.namesVersion.update(v => v + 1);
    } catch {
      // Names are non-critical; leave symbols as the fallback display.
    }
  }

  private async fetchMultiBars(symbols: string[], start: string): Promise<Record<string, AlpacaBar[]>> {
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

  private buildFlowHistory(dailyBars: Record<string, AlpacaBar[]>, historyStart: string): FlowSeries[] {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const spyBars = (dailyBars[BENCHMARK] ?? [])
      .filter(bar => bar.t.split('T')[0] < today)
      .sort((a, b) => a.t.localeCompare(b.t));
    const dates = spyBars.map(b => b.t.split('T')[0]);

    const byDate = new Map<string, Map<string, AlpacaBar>>();
    for (const [sym, arr] of Object.entries(dailyBars)) {
      const m = new Map<string, AlpacaBar>();
      for (const b of arr) m.set(b.t.split('T')[0], b);
      byDate.set(sym, m);
    }

    const sectors = Object.keys(SECTOR_SYMBOLS);
    const seriesData = new Map<string, FlowSeries['data']>(sectors.map(s => [s, []]));

    for (let i = 1; i < dates.length; i++) {
      const date = dates[i], prev = dates[i - 1];
      if (date < historyStart) continue;
      const spyPrev = spyBars[i - 1].c, spyCur = spyBars[i].c;
      if (!Number.isFinite(spyPrev) || spyPrev <= 0 || !Number.isFinite(spyCur) || spyCur <= 0) continue;
      const spyChange = ((spyCur - spyPrev) / spyPrev) * 100;
      for (const sector of sectors) {
        const entries: FlowEntry[] = [];
        for (const sym of SECTOR_SYMBOLS[sector]) {
          const m = byDate.get(sym);
          const cur = m?.get(date), pv = m?.get(prev);
          if (!cur || !pv || !Number.isFinite(cur.c) || cur.c <= 0 || !Number.isFinite(pv.c) || pv.c <= 0 ||
              !Number.isFinite(cur.v) || cur.v < 0 || !Number.isFinite(pv.v) || pv.v < 0) continue;
          entries.push({ symbol: sym, change: ((cur.c - pv.c) / pv.c) * 100, vol: cur.v, prevVol: pv.v });
        }
        if (!entries.length) continue;
        seriesData.get(sector)!.push({ time: date, value: this.aggregateFlow(sector, entries, spyChange).flowScore });
      }
    }

    return sectors.map(sector => ({ sector, color: SECTOR_COLORS[sector], data: seriesData.get(sector)! }));
  }
}
