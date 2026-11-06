import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { MoneyFlowComponent } from './money-flow.component';
import { AlpacaService } from '../../services/alpaca.service';
import { FmpService } from '../../services/fmp.service';
import { WatchlistService } from '../../services/watchlist.service';
import { AlpacaBar, AlpacaSnapshot } from '../../models/alpaca.models';
import { SECTOR_SYMBOLS } from '../../data/sector-symbols';

function bar(date: string, close: number): AlpacaBar {
  return { t: `${date}T05:00:00Z`, o: close, h: close, l: close, c: close, v: 100, n: 1, vw: close };
}

describe('MoneyFlowComponent sector rotation history', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<MoneyFlowComponent>>;
  let component: MoneyFlowComponent;
  let bars: Record<string, AlpacaBar[]>;
  let getMultiBars: ReturnType<typeof vi.fn>;
  let snapshots: Record<string, AlpacaSnapshot>;
  let getSnapshots: ReturnType<typeof vi.fn>;
  let load: () => Promise<void>;

  async function loadHistory(): Promise<void> {
    await load();
    fixture.autoDetectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T18:00:00Z'));
    bars = {
      SPY: [bar('2026-10-30', 100), bar('2026-11-02', 100), bar('2026-11-03', 100), bar('2026-11-06', 100)],
      AAPL: [bar('2026-10-30', 100), bar('2026-11-02', 110), bar('2026-11-03', 99), bar('2026-11-06', 200)],
      UNH: [bar('2026-10-30', 100), bar('2026-11-02', 90), bar('2026-11-03', 99), bar('2026-11-06', 1)],
    };
    snapshots = {};
    getSnapshots = vi.fn(() => of({ body: snapshots }));
    getMultiBars = vi.fn((symbols: string[]) => of({
      body: {
        bars: Object.fromEntries(symbols.filter(symbol => bars[symbol]).map(symbol => [symbol, bars[symbol]])),
        next_page_token: null,
      },
    }));
    await TestBed.configureTestingModule({
      imports: [MoneyFlowComponent],
      providers: [
        { provide: AlpacaService, useValue: { getSnapshots, getMultiBars } },
        { provide: FmpService, useValue: { getCachedCompanyName: (symbol: string) => symbol } },
        { provide: WatchlistService, useValue: { version: () => () => 0, has: () => false } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MoneyFlowComponent);
    component = fixture.componentInstance;
    load = component.load.bind(component);
    vi.spyOn(component, 'load').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('backfills immediately, orders completed sessions newest first, and computes rank changes', async () => {
    await loadHistory();
    expect(component.error()).toBeNull();
    expect(component.loaded()).toBe(true);
    expect(component.rankingSessions().map(session => session.date)).toEqual(['2026-11-03', '2026-11-02']);
    const latest = component.rankingSessions()[0];
    expect(latest.rankings.map(entry => entry.sector)).toEqual(['Healthcare', 'Technology']);
    expect(latest.rankings[0]).toMatchObject({ rank: 1, score: 15, change: 1 });
    expect(latest.rankings[1]).toMatchObject({ rank: 2, score: -15, change: -1 });
    expect(component.rankingSessions()[1].rankings[0].change).toBeNull();
    expect(latest.missing).toContain('Energy');
    expect(component.rankingTooltip(latest, latest.rankings[0])).toContain('Up 1');
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('.rotation-grid tbody tr')).toHaveLength(11);
    expect(element.querySelectorAll('.rotation-grid thead time')).toHaveLength(2);
    expect(element.querySelector('.missing-cell')?.textContent).toContain('No data');
    expect(element.querySelector('.flow-chart')).toBeNull();
    expect(element.querySelector('.flow-table')).not.toBeNull();
  });

  it('uses the prior bar before the history cutoff to rank the first retained session', async () => {
    bars = {
      SPY: [bar('2026-08-05', 100), bar('2026-08-06', 100)],
      AAPL: [bar('2026-08-05', 100), bar('2026-08-06', 110)],
    };
    await loadHistory();
    expect(component.rankingSessions().map(session => session.date)).toEqual(['2026-08-06']);
    expect(component.rankingSessions()[0].rankings[0].score).toBe(15);
  });

  it('excludes the current New York date even when UTC has reached the next day', async () => {
    vi.setSystemTime(new Date('2026-11-04T01:00:00Z'));
    await loadHistory();
    expect(component.rankingSessions().map(session => session.date)).toEqual(['2026-11-02']);
  });

  it('breaks score ties alphabetically and keeps colors attached to sector names', async () => {
    bars['UNH'] = bars['AAPL'].map(point => ({ ...point }));
    await loadHistory();
    expect(component.rankingSessions()[0].rankings.map(entry => entry.sector)).toEqual(['Healthcare', 'Technology']);
    const technologyColors = component.rankingSessions().map(session => session.rankings.find(entry => entry.sector === 'Technology')?.color);
    expect(technologyColors).toEqual(['#4a9eff', '#4a9eff']);
  });

  it('does not rank sectors with invalid bars or missing previous-session bars', async () => {
    bars['UNH'][2].c = NaN;
    bars['AAPL'] = bars['AAPL'].filter(point => !point.t.startsWith('2026-11-02'));
    bars['XOM'] = [bar('2026-11-02', 100), bar('2026-11-03', 110)];
    await loadHistory();
    const latest = component.rankingSessions()[0];
    expect(latest.rankings.map(entry => entry.sector)).toEqual(['Energy']);
    expect(latest.missing).toContain('Technology');
    expect(latest.missing).toContain('Healthcare');
    expect(latest.rankings[0].change).toBeNull();
  });

  it('defaults to exactly 20 columns and allows 60 without changing daily rankings', async () => {
    const dates: string[] = [];
    for (let offset = 1; dates.length < 66; offset++) {
      const date = new Date('2026-11-06T12:00:00Z');
      date.setUTCDate(date.getUTCDate() - offset);
      if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) dates.push(date.toISOString().split('T')[0]);
    }
    bars = Object.fromEntries(['SPY', ...Object.values(SECTOR_SYMBOLS).map(symbols => symbols[0])]
      .map(symbol => [symbol, dates.map(date => bar(date, 100))]));
    await loadHistory();
    expect(component.rankingSessions()).toHaveLength(65);
    expect(component.visibleSessions()).toHaveLength(20);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.rotation-grid thead time')).toHaveLength(20);
    const newest = component.visibleSessions()[0];
    const rangeButtons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.history-window button');
    rangeButtons[1].click();
    await fixture.whenStable();
    expect(component.visibleSessions()).toHaveLength(60);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.rotation-grid thead time')).toHaveLength(60);
    expect(component.visibleSessions()[0]).toBe(newest);
  });

  it('supports persistent selection, hover highlighting, and keyboard focus', async () => {
    await loadHistory();
    const element: HTMLElement = fixture.nativeElement;
    const cell = element.querySelector<HTMLButtonElement>('.rank-cell')!;
    cell.click();
    await fixture.whenStable();
    expect(component.selectedSector()).toBe('Healthcare');
    expect(cell.getAttribute('aria-pressed')).toBe('true');
    expect(element.querySelectorAll('.rank-cell.dimmed')).toHaveLength(2);
    const technologyCell = [...element.querySelectorAll<HTMLButtonElement>('.rank-cell')].find(button => button.textContent?.trim() === 'Technology')!;
    technologyCell.dispatchEvent(new Event('mouseenter'));
    await fixture.whenStable();
    expect(component.highlightedSector()).toBe('Technology');
    technologyCell.dispatchEvent(new Event('mouseleave'));
    await fixture.whenStable();
    expect(component.highlightedSector()).toBe('Healthcare');
    technologyCell.focus();
    await fixture.whenStable();
    expect(component.highlightedSector()).toBe('Technology');
    technologyCell.blur();
    cell.click();
    await fixture.whenStable();
    expect(component.selectedSector()).toBeNull();
    expect(element.querySelectorAll('.rank-cell.dimmed')).toHaveLength(0);
  });

  it('shows an explicit empty state when completed bars are unavailable', async () => {
    bars = {};
    await loadHistory();
    expect(component.visibleSessions()).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent).toContain('No completed-session history');
  });

  it('surfaces historical fetch failures and allows retry', async () => {
    getMultiBars.mockReturnValueOnce(throwError(() => new Error('History unavailable')));
    await loadHistory();
    expect(component.error()).toBe('History unavailable');
    expect(component.loaded()).toBe(false);
    await load();
    await fixture.whenStable();
    expect(component.error()).toBeNull();
    expect(component.visibleSessions()).toHaveLength(2);
  });

  function prepareBreakout(price = 100): void {
    snapshots = {
      AAPL: {
        latestTrade: { p: price, s: 1, t: '2026-11-06T18:00:00Z' },
        latestQuote: null,
        minuteBar: null,
        dailyBar: { o: price, h: price, l: price, c: price, v: 100, t: '2026-11-06T05:00:00Z' },
        prevDailyBar: { o: 100, h: 100, l: 100, c: 100, v: 100, t: '2026-11-05T05:00:00Z' },
      },
    };
    bars = { AAPL: [] };
    for (let offset = 1; bars['AAPL'].length < 200; offset++) {
      const date = new Date('2026-11-06T12:00:00Z');
      date.setUTCDate(date.getUTCDate() - offset);
      if (![0, 6].includes(date.getUTCDay())) bars['AAPL'].push(bar(date.toISOString().split('T')[0], 100));
    }
  }

  it('does not run breakouts or fetch their long lookback on initialization', async () => {
    await loadHistory();
    expect(component.breakoutsLoaded()).toBe(false);
    expect(component.averageBreakoutGroups()).toEqual([]);
    expect(getMultiBars.mock.calls.length).toBeGreaterThan(0);
    expect(getMultiBars.mock.calls.every(call => call[2] === '2026-07-27')).toBe(true);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.breakouts')).toBeNull();
    expect(element.querySelector('.breakout-controls button')?.textContent).toContain('Scan for breakouts');
  });

  it('runs the longer breakout scan on click and can refresh its results', async () => {
    await loadHistory();
    const history = component.rankingSessions();
    prepareBreakout(250);
    getMultiBars.mockClear();
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLButtonElement>('.breakout-controls button')!.click();
    // Wait for the async scan, which is not part of Angular's pending tasks.
    await vi.waitFor(() => expect(component.breakoutsLoaded()).toBe(true));
    await fixture.whenStable();
    expect(getMultiBars.mock.calls.length).toBeGreaterThan(0);
    expect(getMultiBars.mock.calls.every(call => call[2] === '2025-12-21')).toBe(true);
    expect(component.averageBreakoutGroups().map(group => group.rows[0]?.priceMultiple)).toEqual([2.5, 2.5, 2.5]);
    expect(element.querySelectorAll('.breakouts')).toHaveLength(3);
    expect(component.breakoutsAsOf()).not.toBe('');
    expect(component.rankingSessions()).toBe(history);
    prepareBreakout();
    await component.loadBreakouts();
    await fixture.whenStable();
    expect(element.querySelectorAll('.breakouts')).toHaveLength(0);
    expect(element.querySelector('.breakout-controls')?.textContent).toContain('No qualifying 200-session breakouts');
  });

  it('shows loading, prevents duplicate scans, and surfaces errors separately with retry', async () => {
    await loadHistory();
    prepareBreakout(250);
    const pending = new Subject<{ body: Record<string, AlpacaSnapshot> }>();
    getSnapshots.mockReturnValueOnce(pending);
    const scan = component.loadBreakouts();
    await fixture.whenStable();
    expect(component.breakoutsLoading()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.breakout-controls button')?.disabled).toBe(true);
    const calls = getSnapshots.mock.calls.length;
    await component.loadBreakouts();
    expect(getSnapshots).toHaveBeenCalledTimes(calls);
    pending.error(new Error('Breakout snapshots unavailable'));
    await scan;
    await fixture.whenStable();
    expect(component.breakoutsError()).toBe('Breakout snapshots unavailable');
    expect(component.error()).toBeNull();
    expect(component.loaded()).toBe(true);
    expect(component.breakoutsLoading()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('Breakout snapshots unavailable');
    await component.loadBreakouts();
    expect(component.breakoutsError()).toBeNull();
    expect(component.breakoutsLoaded()).toBe(true);
  });

  it('reports missing scan data instead of claiming there are no breakouts', async () => {
    await loadHistory();
    await component.loadBreakouts();
    expect(component.breakoutsError()).toBe('No current price data available for breakout analysis.');
    prepareBreakout();
    bars = {};
    await component.loadBreakouts();
    expect(component.breakoutsError()).toBe('No historical daily bars available for breakout analysis.');
    expect(component.breakoutsLoaded()).toBe(false);
  });

  it('requires full completed history and a multiple strictly greater than two', async () => {
    await loadHistory();
    prepareBreakout(200);
    await component.loadBreakouts();
    expect(component.averageBreakoutGroups().every(group => group.rows.length === 0)).toBe(true);
    prepareBreakout(250);
    bars['AAPL'] = bars['AAPL'].slice(0, 50);
    bars['AAPL'].push(bar('2026-11-06', 1));
    await component.loadBreakouts();
    expect(component.averageBreakoutGroups().map(group => group.rows.length)).toEqual([1, 1, 0]);
  });

  it('explains the score with a visual example matching the actual formula', async () => {
    const previousDate = '2026-11-02';
    const currentDate = '2026-11-03';
    bars = { SPY: [bar(previousDate, 100), bar(currentDate, 100.5)] };
    SECTOR_SYMBOLS['Technology'].slice(0, 10).forEach((symbol, index) => {
      bars[symbol] = [bar(previousDate, 100), bar(currentDate, index < 7 ? 103 : 98)];
    });
    await loadHistory();
    expect(component.rankingSessions()[0].rankings[0].score).toBe(3);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.score-guide')?.textContent).toContain('not actual money');
    expect(element.querySelectorAll('.score-example__track')).toHaveLength(3);
    expect(element.querySelector('.score-example__total')?.textContent).toContain('Flow Score +3.00');
  });

  it('opens the definition from the Flow Score header and closes it on demand', async () => {
    await loadHistory();
    const element: HTMLElement = fixture.nativeElement;
    const dialog = element.querySelector<HTMLDialogElement>('#score-definition')!;
    const trigger = element.querySelector<HTMLButtonElement>('.flow-table th button[aria-haspopup="dialog"]')!;
    expect(dialog.open).toBe(false);
    expect(trigger.textContent).toContain('Definition');
    expect(trigger.closest('th')?.textContent).toContain('Flow Score');
    expect(dialog.getAttribute('aria-labelledby')).toBe('score-guide-title');
    expect(trigger.getAttribute('aria-controls')).toBe(dialog.id);
    // jsdom does not implement native modal dialog methods.
    const showModal = vi.fn(() => { dialog.open = true; });
    const close = vi.fn(() => { dialog.open = false; });
    dialog.showModal = showModal;
    dialog.close = close;
    trigger.click();
    await fixture.whenStable();
    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(true);
    dialog.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    expect(close).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(false);
  });
});
