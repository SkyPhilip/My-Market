import { HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Component, input, signal } from '@angular/core';
import { of } from 'rxjs';
import { WatchlistComponent } from './watchlist.component';
import { AlpacaService } from '../../services/alpaca.service';
import { FmpService } from '../../services/fmp.service';
import { FinnhubService } from '../../services/finnhub.service';
import { WatchlistService } from '../../services/watchlist.service';
import { PortfolioGainLossService } from '../../services/portfolio-gain-loss.service';
import { StopMonitorService } from '../../services/stop-monitor.service';
import { PortfolioGainLossChartComponent } from './portfolio-gain-loss-chart.component';

@Component({ selector: 'app-portfolio-gain-loss-chart', template: '' })
class PortfolioChartStub {
  points = input.required<unknown[]>();
}

describe('WatchlistComponent retirement holdings', () => {
  const key = 'watchlist_Current Holdings';
  let original: string | null;
  let fixture: ReturnType<typeof TestBed.createComponent<WatchlistComponent>>;
  const recordSnapshot = vi.fn();

  beforeEach(async () => {
    original = localStorage.getItem(key);
    localStorage.removeItem(key);
    recordSnapshot.mockClear();
    await TestBed.configureTestingModule({
      imports: [WatchlistComponent],
      providers: [
        { provide: AlpacaService, useValue: {
          getSnapshots: (symbols: string[]) => of(new HttpResponse({
            body: Object.fromEntries(symbols.map(symbol => [symbol, { latestTrade: { p: 100 } }])),
          })),
        } },
        { provide: FmpService, useValue: {
          hasProfile: () => true,
          getCachedSector: () => 'Technology',
          getCachedCompanyName: (symbol: string) => symbol,
          getCachedLastDividend: () => null,
          isEtfOrFund: () => false,
        } },
        { provide: FinnhubService, useValue: { getNextEarnings: () => of(null) } },
        { provide: WatchlistService, useValue: { version: () => signal(0), getEntries: () => [], getPlatform: () => null } },
        { provide: PortfolioGainLossService, useValue: { recordSnapshot, snapshots: signal([]) } },
        { provide: StopMonitorService, useValue: { stops: signal(new Map()) } },
      ],
    }).overrideComponent(WatchlistComponent, {
      remove: { imports: [PortfolioGainLossChartComponent] },
      add: { imports: [PortfolioChartStub] },
    }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    if (original === null) localStorage.removeItem(key);
    else localStorage.setItem(key, original);
  });

  async function create(name = 'Current Holdings'): Promise<void> {
    fixture = TestBed.createComponent(WatchlistComponent);
    fixture.componentRef.setInput('heading', name);
    fixture.componentRef.setInput('watchlistName', name);
    await fixture.whenStable();
  }

  it('toggles and persists the marker for only the selected lot, including after reload', async () => {
    localStorage.setItem(key, JSON.stringify([
      { symbol: 'AAPL', lotId: 'one', costBasis: 10, shares: 1, platform: 'fidelity' },
      { symbol: 'AAPL', lotId: 'two', costBasis: 20, shares: 2 },
    ]));
    await create();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('.retirement-marker')).toHaveLength(0);
    element.querySelectorAll<HTMLButtonElement>('.symbol-text--platform')[0].click();
    await fixture.whenStable();
    const toggle = element.querySelector<HTMLButtonElement>('.retirement-option')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent?.trim()).toBe('Tax deferred account');
    toggle.click();
    await fixture.whenStable();
    expect(element.querySelectorAll('.retirement-marker')).toHaveLength(1);
    expect(element.querySelector('.retirement-option')).toBeNull();
    expect(element.querySelectorAll<HTMLButtonElement>('.symbol-text--platform')[0].textContent).toBe('AAPL');
    expect(element.querySelectorAll<HTMLButtonElement>('.symbol-text--platform')[0].title).toBe('Holding options — Tax deferred');
    expect(element.querySelectorAll<HTMLButtonElement>('.symbol-text--platform')[1].title).toBe('Holding options');
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject([
      { lotId: 'one', retirementAccount: true, platform: 'fidelity' },
      { lotId: 'two', costBasis: 20 },
    ]);

    await fixture.componentInstance.loadWatchlist();
    await fixture.whenStable();
    expect(fixture.componentInstance.watchlistRows().map(row => row.retirementAccount)).toEqual([true, false]);
    element.querySelectorAll<HTMLButtonElement>('.symbol-text--platform')[0].click();
    await fixture.whenStable();
    expect(element.querySelector<HTMLButtonElement>('.retirement-option')?.textContent?.trim()).toBe('✓ Tax deferred account');
    element.querySelector<HTMLButtonElement>('.retirement-option')!.click();
    await fixture.whenStable();
    expect(element.querySelectorAll('.retirement-marker')).toHaveLength(0);
    expect(element.querySelector('.retirement-option')).toBeNull();
    expect(element.querySelectorAll<HTMLButtonElement>('.symbol-text--platform')[0].textContent).toBe('AAPL');
    expect(element.querySelectorAll<HTMLButtonElement>('.symbol-text--platform')[0].title).toBe('Holding options');
    expect(JSON.parse(localStorage.getItem(key)!)[0].retirementAccount).toBeUndefined();
  });

  it('includes tax-deferred status alongside the platform in the symbol tooltip', async () => {
    localStorage.setItem(key, JSON.stringify([
      { symbol: 'AAPL', lotId: 'one', costBasis: 10, shares: 1, platform: 'jpmorgan', retirementAccount: true },
    ]));
    await create();
    const element: HTMLElement = fixture.nativeElement;
    const symbol = element.querySelector<HTMLButtonElement>('.symbol-text--platform')!;
    expect(symbol.title).toBe('Held at JP Morgan — click for holding options — Tax deferred');
    expect(symbol.getAttribute('aria-label')).toContain('Tax deferred');
    expect(element.querySelector<HTMLElement>('.retirement-marker')?.title).toContain('Tax deferred');
  });

  it('updates the asterisk color when the holding platform changes', async () => {
    localStorage.setItem(key, JSON.stringify([
      { symbol: 'AMZN', lotId: 'one', costBasis: 10, shares: 1, platform: 'schwab', retirementAccount: true },
    ]));
    await create();
    const element: HTMLElement = fixture.nativeElement;
    const marker = () => element.querySelector<HTMLElement>('.retirement-marker')!;
    const symbol = () => element.querySelector<HTMLButtonElement>('.symbol-text--platform')!;
    expect(marker().style.color).toBe('rgb(74, 158, 255)');
    expect(marker().style.color).toBe(symbol().style.color);

    symbol().click();
    await fixture.whenStable();
    const jpmorgan = [...element.querySelectorAll<HTMLButtonElement>('.platform-option')]
      .find(button => button.textContent?.trim() === 'JP Morgan')!;
    jpmorgan.click();
    await fixture.whenStable();
    expect(marker().style.color).toBe('rgb(227, 179, 65)');
    expect(marker().style.color).toBe(symbol().style.color);

    symbol().click();
    await fixture.whenStable();
    element.querySelector<HTMLButtonElement>('.platform-menu .platform-option')!.click();
    await fixture.whenStable();
    expect(marker().style.color).toBe('');
    expect(symbol().style.color).toBe('');
  });

  it('restores symbols when the picker is dismissed or another lot is opened', async () => {
    localStorage.setItem(key, JSON.stringify([
      { symbol: 'AAPL', lotId: 'one', costBasis: 10, shares: 1 },
      { symbol: 'MSFT', lotId: 'two', costBasis: 20, shares: 2 },
    ]));
    await create();
    const element: HTMLElement = fixture.nativeElement;
    element.querySelectorAll<HTMLButtonElement>('.symbol-text--platform')[0].click();
    await fixture.whenStable();
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await fixture.whenStable();
    expect(element.querySelectorAll('.symbol-text--platform')).toHaveLength(2);
    expect(element.querySelector('.platform-trigger--inline')).toBeNull();

    element.querySelectorAll<HTMLButtonElement>('.symbol-text--platform')[0].click();
    await fixture.whenStable();
    element.querySelector<HTMLButtonElement>('.symbol-text--platform')!.click();
    await fixture.whenStable();
    expect(element.querySelector<HTMLButtonElement>('.symbol-text--platform')?.textContent).toBe('AAPL');
    expect(element.querySelector('.retirement-option')).not.toBeNull();
    element.querySelector<HTMLButtonElement>('.platform-trigger--inline')!.click();
    await fixture.whenStable();
    expect(element.querySelectorAll('.symbol-text--platform')).toHaveLength(2);
    expect(element.querySelector('.platform-trigger--inline')).toBeNull();
  });

  it('closes the symbol menu on Escape without changing the holding', async () => {
    localStorage.setItem(key, JSON.stringify([
      { symbol: 'AAPL', lotId: 'one', costBasis: 10, shares: 1, platform: 'jpmorgan', retirementAccount: true },
    ]));
    await create();
    const element: HTMLElement = fixture.nativeElement;
    element.querySelector<HTMLButtonElement>('.symbol-text--platform')!.click();
    await fixture.whenStable();
    expect(element.querySelector('.retirement-option')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(element.querySelector('.retirement-option')).toBeNull();
    expect(element.querySelector('.platform-trigger--inline')).toBeNull();
    expect(element.querySelector<HTMLButtonElement>('.symbol-text--platform')?.textContent).toBe('AAPL');
    expect(element.querySelector('.retirement-marker')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(key)!)[0]).toMatchObject({ platform: 'jpmorgan', retirementAccount: true });

    element.querySelector<HTMLButtonElement>('.symbol-text--platform')!.click();
    await fixture.whenStable();
    expect(element.querySelector('.retirement-option')).not.toBeNull();
  });

  it('adds a marked lot and resets the checkbox for the next holding', async () => {
    await create();
    const element: HTMLElement = fixture.nativeElement;
    const component = fixture.componentInstance;
    component.newSymbol = 'MSFT';
    component.newShares = '2';
    component.newCostBasis = '100';
    const checkbox = element.querySelector<HTMLInputElement>('input[name="retirementAccount"]')!;
    checkbox.click();
    await fixture.whenStable();
    await component.addSymbol(new Event('submit'));
    await fixture.whenStable();
    expect(component.watchlistRows()[0].retirementAccount).toBe(true);
    expect(JSON.parse(localStorage.getItem(key)!)[0].retirementAccount).toBe(true);
    expect(checkbox.checked).toBe(false);
    expect(element.querySelector('.retirement-marker')?.textContent).toBe('*');
    await component.loadWatchlist();
    await fixture.whenStable();
    expect(component.watchlistRows()[0].retirementAccount).toBe(true);
    expect(element.querySelector('.retirement-marker')?.textContent).toBe('*');
  });

  it('combines retirement and platform filters for totals and platform breakdowns', async () => {
    localStorage.setItem(key, JSON.stringify([
      { symbol: 'AAPL', lotId: 'one', costBasis: 10, shares: 1, platform: 'schwab', retirementAccount: true },
      { symbol: 'AAPL', lotId: 'two', costBasis: 120, shares: 1, platform: 'schwab' },
      { symbol: 'MSFT', lotId: 'three', costBasis: 30, shares: 1, platform: 'jpmorgan', retirementAccount: true },
      { symbol: 'GOOG', lotId: 'four', costBasis: 40, shares: 1 },
    ]));
    await create();
    const element: HTMLElement = fixture.nativeElement;
    const taxFilter = element.querySelector<HTMLSelectElement>('.retirement-filter')!;
    const select = element.querySelector<HTMLSelectElement>('.platform-filter select')!;
    const visibleLots = () => fixture.componentInstance.sortedWatchlistRows().map(row => row.lotId);
    expect(visibleLots()).toEqual(['one', 'two', 'three', 'four']);
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(200);
    expect(element.querySelector('.summary-row')?.textContent).toContain('Totals');
    expect(element.querySelector('.summary-row')?.textContent).not.toContain('Portfolio Totals');

    taxFilter.value = 'deferred';
    taxFilter.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(visibleLots()).toEqual(['one', 'three']);
    expect(element.querySelectorAll('.retirement-marker')).toHaveLength(2);
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(40);
    expect(fixture.componentInstance.portfolioMarketValue()).toBe(200);
    expect(fixture.componentInstance.portfolioTotalGainLoss()).toBe(160);
    expect(fixture.componentInstance.portfolioTotalGainLossPercent()).toBe(400);
    expect(fixture.componentInstance.portfolioTotalGains()).toBe(160);
    expect(fixture.componentInstance.portfolioTotalLosses()).toBe(0);
    expect(fixture.componentInstance.weightPercent(fixture.componentInstance.watchlistRows()[0])).toBe(5);
    expect(fixture.componentInstance.portfolioPlatformGainLossTotals()).toMatchObject([
      { id: 'schwab', totalGains: 90, totalLosses: 0 },
      { id: 'jpmorgan', totalGains: 70, totalLosses: 0 },
    ]);
    expect(element.querySelector('.summary-row')?.textContent).toContain('Totals *');
    expect([...element.querySelectorAll('.platform-total-row .gain-loss-summary__scope')].map(e => e.textContent?.trim())).toEqual(['Schwab *', 'JP Morgan *']);
    expect(element.querySelector('.gain-loss-summary-row .gain-loss-summary__scope')?.textContent).toContain('Totals *');
    select.value = 'schwab';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(visibleLots()).toEqual(['one']);
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(10);
    expect(fixture.componentInstance.portfolioMarketValue()).toBe(100);
    expect(fixture.componentInstance.portfolioTotalGainLoss()).toBe(90);
    expect(fixture.componentInstance.portfolioTotalGainLossPercent()).toBe(900);
    expect(fixture.componentInstance.portfolioPlatformGainLossTotals()).toMatchObject([
      { id: 'schwab', totalGains: 90, totalLosses: 0 },
    ]);
    expect(element.querySelectorAll('.platform-total-row')).toHaveLength(1);
    expect(element.querySelector('.gain-loss-summary-row')).toBeNull();
    expect(element.querySelector('.summary-row')?.textContent).toContain('Total Cost');

    element.querySelector<HTMLButtonElement>('.symbol-text--platform')!.click();
    await fixture.whenStable();
    element.querySelector<HTMLButtonElement>('.retirement-option')!.click();
    await fixture.whenStable();
    expect(recordSnapshot).toHaveBeenLastCalledWith(220, -20);
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(0);

    select.value = 'other';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(element.querySelector('.platform-filter-empty')?.textContent).toContain('No holdings match');
    expect(element.querySelectorAll('.platform-total-row')).toHaveLength(0);
    expect(element.querySelector('.gain-loss-summary-row')).not.toBeNull();
    taxFilter.value = 'all';
    taxFilter.dispatchEvent(new Event('change'));
    select.value = 'schwab';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(visibleLots()).toEqual(['one', 'two']);
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(130);
    expect(fixture.componentInstance.portfolioTotalGains()).toBe(90);
    expect(fixture.componentInstance.portfolioTotalLosses()).toBe(-20);
    expect(element.querySelector('.summary-row')?.textContent).not.toContain('Totals *');
  });

  it('shows zero retirement totals when no holdings are marked', async () => {
    localStorage.setItem(key, JSON.stringify([
      { symbol: 'AAPL', lotId: 'one', costBasis: 10, shares: 1, platform: 'schwab' },
    ]));
    await create();
    const element: HTMLElement = fixture.nativeElement;
    const taxFilter = element.querySelector<HTMLSelectElement>('.retirement-filter')!;
    taxFilter.value = 'deferred';
    taxFilter.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(0);
    expect(fixture.componentInstance.portfolioMarketValue()).toBe(0);
    expect(fixture.componentInstance.portfolioTotalGainLossPercent()).toBe(0);
    expect(fixture.componentInstance.portfolioPlatformGainLossTotals()).toEqual([]);
    expect(element.querySelector('.summary-row')?.textContent).toContain('Totals *');
  });

  it('filters unmarked lots and totals by the selected platform', async () => {
    localStorage.setItem(key, JSON.stringify([
      { symbol: 'AMZN', lotId: 'one', costBasis: 10, shares: 1, platform: 'schwab', retirementAccount: true },
      { symbol: 'AMZN', lotId: 'two', costBasis: 120, shares: 1, platform: 'schwab' },
      { symbol: 'MSFT', lotId: 'three', costBasis: 30, shares: 1, platform: 'jpmorgan', retirementAccount: false },
      { symbol: 'GOOG', lotId: 'four', costBasis: 40, shares: 1, platform: 'jpmorgan', retirementAccount: true },
    ]));
    await create();
    const element: HTMLElement = fixture.nativeElement;
    const taxFilter = element.querySelector<HTMLSelectElement>('.retirement-filter')!;
    const platformFilter = element.querySelector<HTMLSelectElement>('.platform-filter select')!;
    const visibleLots = () => fixture.componentInstance.sortedWatchlistRows().map(row => row.lotId);
    taxFilter.value = 'non-deferred';
    taxFilter.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(visibleLots()).toEqual(['two', 'three']);
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(150);
    expect(fixture.componentInstance.portfolioMarketValue()).toBe(200);
    expect(fixture.componentInstance.portfolioTotalGains()).toBe(70);
    expect(fixture.componentInstance.portfolioTotalLosses()).toBe(-20);
    expect(fixture.componentInstance.portfolioPlatformGainLossTotals()).toMatchObject([
      { id: 'schwab', totalGains: 0, totalLosses: -20 },
      { id: 'jpmorgan', totalGains: 70, totalLosses: 0 },
    ]);
    expect(element.querySelector('.summary-row')?.textContent).toContain('Totals (non-tax deferred)');
    expect([...element.querySelectorAll('.platform-total-row .gain-loss-summary__scope')].map(e => e.textContent?.trim())).toEqual(['Schwab', 'JP Morgan']);
    expect(element.querySelector<HTMLElement>('.platform-total-row .gain-loss-summary__scope')?.title).toBe('Non-tax deferred only');
    expect(element.textContent).toContain('The history chart shows all holdings, regardless of the selected filters.');

    platformFilter.value = 'jpmorgan';
    platformFilter.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(visibleLots()).toEqual(['three']);
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(30);
    expect(fixture.componentInstance.portfolioMarketValue()).toBe(100);
    expect(fixture.componentInstance.portfolioTotalGains()).toBe(70);
    expect(fixture.componentInstance.portfolioTotalLosses()).toBe(0);
    expect(fixture.componentInstance.portfolioPlatformGainLossTotals()).toMatchObject([
      { id: 'jpmorgan', totalGains: 70, totalLosses: 0 },
    ]);
    expect([...element.querySelectorAll('.platform-total-row .gain-loss-summary__scope')].map(e => e.textContent?.trim())).toEqual(['JP Morgan']);
    platformFilter.value = 'schwab';
    platformFilter.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(visibleLots()).toEqual(['two']);
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(120);
    platformFilter.value = 'other';
    platformFilter.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(element.querySelector('.platform-filter-empty')?.textContent).toContain('No holdings match');
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(0);
    expect(fixture.componentInstance.portfolioPlatformGainLossTotals()).toEqual([]);
    taxFilter.value = 'all';
    taxFilter.dispatchEvent(new Event('change'));
    platformFilter.value = 'all';
    platformFilter.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(visibleLots()).toEqual(['one', 'two', 'three', 'four']);
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(200);
    expect(element.querySelectorAll('.platform-total-row')).toHaveLength(2);
    expect([...element.querySelectorAll('.platform-total-row .gain-loss-summary__scope')].map(e => e.textContent?.trim())).toEqual(['Schwab', 'JP Morgan']);
    expect(element.querySelector('.gain-loss-summary-row')).not.toBeNull();
    platformFilter.value = 'jpmorgan';
    platformFilter.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(visibleLots()).toEqual(['three', 'four']);
    expect(fixture.componentInstance.portfolioTotalCost()).toBe(70);
    expect(fixture.componentInstance.portfolioMarketValue()).toBe(200);
    expect(fixture.componentInstance.portfolioTotalGainLoss()).toBe(130);
    expect(fixture.componentInstance.portfolioPlatformGainLossTotals()).toMatchObject([
      { id: 'jpmorgan', totalGains: 130, totalLosses: 0 },
    ]);
  });

  it('does not show retirement controls on other watchlists', async () => {
    await create('Watch List');
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('input[name="retirementAccount"]')).toBeNull();
    expect(element.querySelector('.retirement-option')).toBeNull();
    expect(element.querySelector('.retirement-filter')).toBeNull();
  });
});
