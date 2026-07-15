import { Component, signal, inject, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { createChart, IChartApi, ISeriesApi, LineSeries, LineData, Time } from 'lightweight-charts';
import { AlpacaService } from '../../services/alpaca.service';
import { FmpService } from '../../services/fmp.service';
import { WatchlistService } from '../../services/watchlist.service';
import { AlpacaSnapshot, AlpacaBar, AlpacaMover } from '../../models/alpaca.models';
import { SECTOR_SYMBOLS } from '../../data/sector-symbols';

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
  data: LineData<Time>[];
}

const BENCHMARK = 'SPY';
const LOOKBACK_DAYS = 92; // ~3 months
const HISTORY_KEY = 'money_flow_history';
const SECTOR_COLORS = [
  '#4a9eff', '#28a745', '#ffc107', '#b07cff', '#ff7d86', '#40e0d0',
  '#f0934e', '#9ac4ff', '#f06292', '#8bc34a', '#e0e0e0',
];

@Component({
  selector: 'app-money-flow',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './money-flow.component.html',
  styleUrl: './money-flow.component.scss',
})
export class MoneyFlowComponent implements OnInit, OnDestroy {
  private alpaca = inject(AlpacaService);
  private fmp = inject(FmpService);
  private watchlistService = inject(WatchlistService);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly flows = signal<SectorFlow[]>([]);
  readonly asOf = signal('');
  readonly flowHistory = signal<FlowSeries[]>([]);
  readonly hiddenSectors = signal<Set<string>>(new Set());
  readonly expandedSector = signal<string | null>(null);
  readonly moversGainers = signal<AlpacaMover[]>([]);
  readonly moversLosers = signal<AlpacaMover[]>([]);
  // Bumped after lazily fetching company names so the view re-reads the cache.
  private readonly namesVersion = signal(0);

  private chartEl?: ElementRef<HTMLDivElement>;
  @ViewChild('flowChart') set flowChartRef(el: ElementRef<HTMLDivElement> | undefined) {
    this.chartEl = el;
    if (el) this.renderChart();
  }
  private chart: IChartApi | null = null;
  private seriesMap = new Map<string, ISeriesApi<'Line'>>();

  readonly flowScoreTooltip =
    'Flow Score = Rel. Strength + (Breadth − 50) / 50 × 2 + Net Volume Ratio × 3\n' +
    'Rel. Strength = sector avg % change − SPY % change\n' +
    'Breadth = % of constituents up\n' +
    'Net Volume Ratio = (advancing − declining volume) / total volume\n' +
    'Higher = capital rotating into the sector.';

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.loadMovers();
    try {
      const allSymbols = Array.from(new Set([BENCHMARK, ...Object.values(SECTOR_SYMBOLS).flat()]));
      const snaps = await this.fetchAllSnapshots(allSymbols);
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

      // Historical flow-score series (Option A: backfill from daily bars) + persistence (Option B)
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);
      const dailyBars = await this.fetchMultiBars(allSymbols, startDate.toISOString().split('T')[0]);
      const series = this.mergeWithStoredHistory(this.buildFlowHistory(dailyBars, flows));
      // Order legend/series to match the table (sorted by today's flow score)
      const rank = new Map(flows.map((f, i) => [f.sector, i]));
      const ordered = [...series].sort((a, b) => (rank.get(a.sector) ?? 99) - (rank.get(b.sector) ?? 99));
      this.flowHistory.set(ordered);
      // Default to showing only the top sector for readability
      const top = flows[0]?.sector;
      this.hiddenSectors.set(new Set(ordered.filter(s => s.sector !== top).map(s => s.sector)));

      this.loaded.set(true);
      this.renderChart();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load market data.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Top market gainers/losers for the current session (Alpaca screener). Non-fatal. */
  async loadMovers(): Promise<void> {
    try {
      const res = await firstValueFrom(this.alpaca.getMovers(10));
      this.moversGainers.set(res.body?.gainers ?? []);
      this.moversLosers.set(res.body?.losers ?? []);
      const symbols = [...this.moversGainers(), ...this.moversLosers()].map(m => m.symbol);
      const uncached = symbols.filter(s => !this.fmp.getCachedCompanyName(s));
      if (uncached.length) {
        try {
          await firstValueFrom(this.fmp.getProfiles(uncached));
          this.namesVersion.update(v => v + 1);
        } catch {
          // Names are non-critical; symbols remain as the fallback display.
        }
      }
    } catch {
      // movers are supplementary; ignore failures
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

  historyDays(): number {
    return this.flowHistory().reduce((m, s) => Math.max(m, s.data.length), 0);
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

  toggleSector(sector: string): void {
    const next = new Set(this.hiddenSectors());
    if (next.has(sector)) next.delete(sector); else next.add(sector);
    this.hiddenSectors.set(next);
    this.seriesMap.get(sector)?.applyOptions({ visible: !next.has(sector) });
  }

  ngOnDestroy(): void {
    if (this.chart) { this.chart.remove(); this.chart = null; }
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

  private buildFlowHistory(dailyBars: Record<string, AlpacaBar[]>, todayFlows: SectorFlow[]): FlowSeries[] {
    const spyBars = (dailyBars[BENCHMARK] ?? []).slice().sort((a, b) => a.t.localeCompare(b.t));
    const dates = spyBars.map(b => b.t.split('T')[0]);

    const byDate = new Map<string, Map<string, AlpacaBar>>();
    for (const [sym, arr] of Object.entries(dailyBars)) {
      const m = new Map<string, AlpacaBar>();
      for (const b of arr) m.set(b.t.split('T')[0], b);
      byDate.set(sym, m);
    }

    const sectors = Object.keys(SECTOR_SYMBOLS);
    const seriesData = new Map<string, LineData<Time>[]>(sectors.map(s => [s, [] as LineData<Time>[]]));

    for (let i = 1; i < dates.length; i++) {
      const date = dates[i], prev = dates[i - 1];
      const spyPrev = spyBars[i - 1].c, spyCur = spyBars[i].c;
      const spyChange = spyPrev ? ((spyCur - spyPrev) / spyPrev) * 100 : 0;
      for (const sector of sectors) {
        const entries: FlowEntry[] = [];
        for (const sym of SECTOR_SYMBOLS[sector]) {
          const m = byDate.get(sym);
          const cur = m?.get(date), pv = m?.get(prev);
          if (!cur || !pv || !pv.c) continue;
          entries.push({ symbol: sym, change: ((cur.c - pv.c) / pv.c) * 100, vol: cur.v, prevVol: pv.v });
        }
        if (!entries.length) continue;
        seriesData.get(sector)!.push({ time: date as Time, value: this.aggregateFlow(sector, entries, spyChange).flowScore });
      }
    }

    // Append today's live point if newer than the last daily bar
    const todayStr = new Date().toISOString().split('T')[0];
    const lastDate = dates[dates.length - 1];
    if (lastDate && todayStr > lastDate) {
      const todayMap = new Map(todayFlows.map(f => [f.sector, f.flowScore]));
      for (const sector of sectors) {
        const v = todayMap.get(sector);
        if (v !== undefined) seriesData.get(sector)!.push({ time: todayStr as Time, value: v });
      }
    }

    return sectors.map((sector, i) => ({ sector, color: SECTOR_COLORS[i % SECTOR_COLORS.length], data: seriesData.get(sector)! }));
  }

  private mergeWithStoredHistory(series: FlowSeries[]): FlowSeries[] {
    const map = this.readStoredHistory();
    for (const s of series) {
      for (const pt of s.data) {
        const date = pt.time as string;
        (map[date] ??= {})[s.sector] = pt.value;
      }
    }
    this.writeStoredHistory(map);

    const sectors = Object.keys(SECTOR_SYMBOLS);
    const dates = Object.keys(map).sort();
    return sectors.map((sector, i) => ({
      sector,
      color: SECTOR_COLORS[i % SECTOR_COLORS.length],
      data: dates
        .filter(d => map[d][sector] !== undefined)
        .map(d => ({ time: d as Time, value: map[d][sector] })),
    }));
  }

  private readStoredHistory(): Record<string, Record<string, number>> {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private writeStoredHistory(map: Record<string, Record<string, number>>): void {
    try {
      const dates = Object.keys(map).sort();
      const trimmed: Record<string, Record<string, number>> = {};
      for (const d of dates.slice(-250)) trimmed[d] = map[d];
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    } catch {
      // ignore quota errors
    }
  }

  private renderChart(): void {
    const container = this.chartEl?.nativeElement;
    if (!container || !this.flowHistory().length) return;
    if (this.chart) { this.chart.remove(); this.chart = null; this.seriesMap.clear(); }

    this.chart = createChart(container, {
      layout: { background: { color: '#1a1a2e' }, textColor: '#a0a0b0' },
      grid: { vertLines: { color: '#2a3a5e' }, horzLines: { color: '#2a3a5e' } },
      timeScale: { timeVisible: false, secondsVisible: false, borderColor: '#2a3a5e' },
      rightPriceScale: { borderColor: '#2a3a5e' },
      crosshair: { mode: 0 },
    });

    const hidden = this.hiddenSectors();
    for (const s of this.flowHistory()) {
      const series = this.chart.addSeries(LineSeries, {
        color: s.color,
        lineWidth: 2,
        title: s.sector,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: !hidden.has(s.sector),
      });
      series.setData(s.data);
      this.seriesMap.set(s.sector, series);
    }
    this.chart.timeScale().fitContent();
  }
}
