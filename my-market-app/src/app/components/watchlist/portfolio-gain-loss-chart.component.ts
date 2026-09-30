import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { createChart, IChartApi, ISeriesApi, LineData, LineSeries, Time } from 'lightweight-charts';
import { PortfolioGainLossSnapshot } from '../../services/portfolio-gain-loss.service';

type PortfolioRange = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'All';

@Component({
  selector: 'app-portfolio-gain-loss-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './portfolio-gain-loss-chart.component.html',
  styleUrl: './portfolio-gain-loss-chart.component.scss',
})
export class PortfolioGainLossChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) points: PortfolioGainLossSnapshot[] = [];
  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;

  readonly ranges: PortfolioRange[] = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'All'];
  readonly selectedRange = signal<PortfolioRange>('1D');

  private chart: IChartApi | null = null;
  private gainsSeries: ISeriesApi<'Line'> | null = null;
  private lossesSeries: ISeriesApi<'Line'> | null = null;
  private resizeObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    const container = this.chartContainer.nativeElement;
    this.chart = createChart(container, {
      width: container.clientWidth,
      height: 250,
      layout: { background: { color: '#0f1a30' }, textColor: '#a0a0b0' },
      grid: { vertLines: { color: '#1c2a48' }, horzLines: { color: '#2a3a5e' } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a3a5e' },
      rightPriceScale: { borderColor: '#2a3a5e' },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (value: number) => this.formatMoney(value) },
    });
    this.gainsSeries = this.chart.addSeries(LineSeries, {
      color: '#28a745',
      lineWidth: 2,
      title: 'Total Gains',
      priceLineVisible: false,
      pointMarkersVisible: true,
      priceFormat: { type: 'custom', minMove: 0.01, formatter: (value: number) => this.formatMoney(value) },
    });
    this.lossesSeries = this.chart.addSeries(LineSeries, {
      color: '#dc3545',
      lineWidth: 2,
      title: 'Total Losses',
      priceLineVisible: false,
      pointMarkersVisible: true,
      priceFormat: { type: 'custom', minMove: 0.01, formatter: (value: number) => this.formatMoney(value) },
    });
    this.updateSeries();

    this.resizeObserver = new ResizeObserver(() => {
      if (this.chart) {
        this.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      }
    });
    this.resizeObserver.observe(container);
  }

  ngOnChanges(): void {
    this.updateSeries();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.remove();
    this.chart = null;
  }

  selectRange(range: PortfolioRange): void {
    this.selectedRange.set(range);
    this.updateSeries();
    this.chart?.timeScale().fitContent();
  }

  rangePointCount(): number {
    return this.filteredPoints().length;
  }

  formatMoney(value: number): string {
    const magnitude = Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
    return value < 0 ? `-$${magnitude}` : `$${magnitude}`;
  }

  private updateSeries(): void {
    if (!this.gainsSeries || !this.lossesSeries) return;
    const points = this.filteredPoints();
    const toLinePoint = (point: PortfolioGainLossSnapshot, value: number): LineData<Time> => ({
      time: (Date.parse(point.timestamp) / 1000) as Time,
      value,
    });
    this.gainsSeries.setData(points.map(point => toLinePoint(point, point.gains)));
    this.lossesSeries.setData(points.map(point => toLinePoint(point, point.losses)));
    this.chart?.timeScale().fitContent();
  }

  private filteredPoints(): PortfolioGainLossSnapshot[] {
    const range = this.selectedRange();
    const today = this.sessionDate(new Date());
    if (range === '1D') return this.points.filter(point => this.sessionDate(new Date(point.timestamp)) === today);
    if (range === 'All') return this.points;

    const start = new Date();
    switch (range) {
      case '5D': start.setDate(start.getDate() - 7); break;
      case '1M': start.setMonth(start.getMonth() - 1); break;
      case '6M': start.setMonth(start.getMonth() - 6); break;
      case 'YTD': return this.points.filter(point => this.sessionDate(new Date(point.timestamp)).slice(0, 4) === today.slice(0, 4));
      case '1Y': start.setFullYear(start.getFullYear() - 1); break;
      case '5Y': start.setFullYear(start.getFullYear() - 5); break;
    }
    const startDate = this.sessionDate(start);
    return this.points.filter(point => this.sessionDate(new Date(point.timestamp)) >= startDate);
  }

  private sessionDate(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }
}