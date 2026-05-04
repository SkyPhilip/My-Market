import { Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, AfterViewInit } from '@angular/core';
import { createChart, IChartApi, ISeriesApi, LineData, Time, LineSeries } from 'lightweight-charts';

@Component({
  selector: 'app-chart',
  standalone: true,
  template: `<div #chartContainer class="chart-container"></div>`,
  styles: [`
    .chart-container {
      width: 100%;
      height: 250px;
    }
  `]
})
export class ChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;
  @Input() data: LineData<Time>[] = [];
  @Input() color = '#4a9eff';

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Line'> | null = null;

  ngAfterViewInit(): void {
    this.createChartInstance();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.series) {
      this.series.setData(this.data);
      this.chart?.timeScale().fitContent();
    }
  }

  ngOnDestroy(): void {
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
    }
  }

  private createChartInstance(): void {
    const container = this.chartContainer.nativeElement;

    this.chart = createChart(container, {
      layout: {
        background: { color: '#1a1a2e' },
        textColor: '#a0a0b0'
      },
      grid: {
        vertLines: { color: '#2a3a5e' },
        horzLines: { color: '#2a3a5e' }
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        mode: 0
      },
      rightPriceScale: {
        borderColor: '#2a3a5e'
      }
    });

    this.series = this.chart.addSeries(LineSeries, {
      color: this.color,
      lineWidth: 2
    });

    if (this.data.length) {
      this.series.setData(this.data);
      this.chart.timeScale().fitContent();
    }

    const resizeObserver = new ResizeObserver(() => {
      if (this.chart) {
        this.chart.applyOptions({
          width: container.clientWidth
        });
      }
    });
    resizeObserver.observe(container);
  }
}
